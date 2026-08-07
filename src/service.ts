import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildIcsBase64 } from "./ics.js";
import { decodePass, encodePass, qrDataUri } from "./pass.js";
import { sign } from "./sign.js";
import { store } from "./store.js";
import type { ClassTemplate, ClassesConfig, Enrollment, PassPayload, Session } from "./types.js";

const CONFIG_PATH = process.env.CLASSES_CONFIG ?? "config/classes.json";

export const config: ClassesConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export class ClassError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(mins: number): string {
  const h = String(Math.floor(mins / 60) % 24).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function at(date: string, time: string): Date {
  // Interpreted in the server's local timezone — run the server in the
  // studio's timezone (see config.studio.timezone).
  return new Date(`${date}T${time}:00`);
}

/** Build the concrete session for a template on a date, or null if it isn't on. */
function sessionFor(t: ClassTemplate, date: string): Session | null {
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];
  if (!t.days.map((d) => d.toLowerCase()).includes(weekday)) return null;
  const classId = `${t.id}@${date}`;
  const seatsTaken = store.seatsTaken(classId);
  const start = at(date, t.time);
  const closesAt = start.getTime() - config.enrollmentClosesMinutes * 60_000;
  return {
    classId,
    templateId: t.id,
    name: t.name,
    instructor: t.instructor,
    description: t.description,
    room: t.room,
    date,
    time: t.time,
    endsAt: fromMinutes(toMinutes(t.time) + t.durationMinutes),
    durationMinutes: t.durationMinutes,
    capacity: t.capacity,
    seatsTaken,
    seatsLeft: Math.max(0, t.capacity - seatsTaken),
    enrollmentOpen: Date.now() < closesAt && seatsTaken < t.capacity,
    startsAt: start.toISOString(),
  };
}

/** Resolve a `<templateId>@<date>` class id back into a session. */
export function getSession(classId: string): Session | null {
  const atIdx = classId.lastIndexOf("@");
  if (atIdx < 1) return null;
  const templateId = classId.slice(0, atIdx);
  const date = classId.slice(atIdx + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const template = config.classes.find((c) => c.id === templateId);
  if (!template) return null;
  return sessionFor(template, date);
}

export interface ScheduleQuery {
  class?: string;
  date?: string;
  days?: number;
}

/** The free GET /schedule artifact: the calendar with live seat counts. */
export function getSchedule(q: ScheduleQuery) {
  const templates = q.class ? config.classes.filter((c) => c.id === q.class) : config.classes;
  if (q.class && templates.length === 0)
    throw new ClassError(404, "UNKNOWN_CLASS", `no class "${q.class}" — see GET /schedule`);

  const days = Math.min(q.days ?? config.scheduleWindowDays, config.scheduleWindowDays);
  const dates: string[] = [];
  if (q.date) {
    dates.push(q.date);
  } else {
    const today = new Date();
    for (let i = 0; i < days; i++) {
      dates.push(new Date(today.getTime() + i * 86_400_000).toISOString().slice(0, 10));
    }
  }

  const sessions: Session[] = [];
  for (const date of dates) {
    for (const t of templates) {
      const s = sessionFor(t, date);
      if (s && at(date, t.time).getTime() > Date.now()) sessions.push(s);
    }
  }
  sessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return {
    studio: config.studio,
    passPolicy: config.passPolicy,
    enrollmentClosesMinutes: config.enrollmentClosesMinutes,
    generatedAt: new Date().toISOString(),
    classes: config.classes.map((c) => ({
      id: c.id,
      name: c.name,
      instructor: c.instructor,
      description: c.description,
      days: c.days,
      time: c.time,
      durationMinutes: c.durationMinutes,
      capacity: c.capacity,
      room: c.room,
    })),
    sessions,
  };
}

export interface EnrollRequest {
  name: string;
  email?: string;
  payerWallet?: string;
  /** Absolute origin used to build the QR verification URL. */
  baseUrl: string;
}

/**
 * The paid POST /enroll/:classId artifact — seat number, class details, ICS
 * invite and a signed QR pass, all in the 200 body.
 */
export async function enroll(classId: string, req: EnrollRequest) {
  const session = getSession(classId);
  if (!session)
    throw new ClassError(
      404,
      "UNKNOWN_CLASS",
      `no session "${classId}" — class ids look like "vinyasa-am@2026-08-10"; see GET /schedule`,
    );
  if (!req.name || typeof req.name !== "string")
    throw new ClassError(400, "INVALID_NAME", "name is required");
  if (new Date(session.startsAt).getTime() <= Date.now())
    throw new ClassError(409, "CLASS_STARTED", "that class has already started");
  if (!session.enrollmentOpen && session.seatsLeft > 0)
    throw new ClassError(
      409,
      "ENROLLMENT_CLOSED",
      `enrollment closes ${config.enrollmentClosesMinutes} minutes before the class starts`,
    );

  const seatNumber = store.nextSeat(classId, session.capacity);
  if (seatNumber === null)
    throw new ClassError(
      409,
      "CLASS_FULL",
      `${session.name} on ${session.date} is full (${session.capacity} seats) — see GET /schedule for other sessions`,
    );

  const passId = `pass_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const expiresAt = new Date(
    new Date(session.startsAt).getTime() + session.durationMinutes * 60_000,
  ).toISOString();

  const enrollment: Enrollment = {
    passId,
    classId,
    templateId: session.templateId,
    seatNumber,
    holderName: req.name,
    email: req.email,
    payerWallet: req.payerWallet,
    issuedAt: new Date().toISOString(),
    expiresAt,
    status: "valid",
  };
  store.add(enrollment);

  const payload: PassPayload = {
    passId,
    classId,
    seatNumber,
    holder: req.name,
    startsAt: session.startsAt,
    expiresAt,
    studio: config.studio.name,
  };
  const token = encodePass(payload);
  const verifyUrl = `${req.baseUrl}/verify/${token}`;

  const ics = buildIcsBase64({
    uid: `${passId}@x402-classes`,
    start: new Date(session.startsAt),
    durationMinutes: session.durationMinutes,
    summary: `${session.name} — ${config.studio.name} (seat ${seatNumber})`,
    description:
      `${session.description} Instructor: ${session.instructor}. ` +
      `Seat ${seatNumber}. Pass: ${verifyUrl}`,
    location: `${config.studio.address} — ${session.room}`,
  });

  const artifact = {
    passId,
    seatNumber,
    classDetails: {
      classId,
      name: session.name,
      instructor: session.instructor,
      description: session.description,
      room: session.room,
      date: session.date,
      time: session.time,
      endsAt: session.endsAt,
      durationMinutes: session.durationMinutes,
      startsAt: session.startsAt,
      studio: config.studio.name,
      address: config.studio.address,
    },
    holder: { name: req.name, email: req.email },
    seatsLeftAfter: Math.max(0, session.capacity - (session.seatsTaken + 1)),
    passPolicy: config.passPolicy,
    pass: {
      token,
      verifyUrl,
      verifyEndpoint: `GET /verify/${token}`,
      expiresAt,
      // Scannable at the door; also embeddable directly in an <img src="...">.
      qrSvgDataUri: await qrDataUri(verifyUrl),
    },
    ics,
    issuedAt: enrollment.issuedAt,
  };
  return { ...artifact, signature: sign({ ...artifact, pass: { ...artifact.pass, qrSvgDataUri: undefined } }) };
}

/** Roll back a seat — used when payment settlement fails after enrollment. */
export function releaseSeat(passId: string): void {
  store.remove(passId);
}

/** Free GET /verify/:token — validate a pass at the door. */
export function verifyPass(token: string) {
  const decoded = decodePass(token);
  if (!decoded.valid || !decoded.payload) {
    return { valid: false, reason: decoded.reason ?? "invalid pass", checkedAt: new Date().toISOString() };
  }
  const enrollment = store.getPass(decoded.payload.passId);
  if (!enrollment)
    return {
      valid: false,
      reason: "signature is good but this pass is not on the roster — it may have been refunded",
      payload: decoded.payload,
      checkedAt: new Date().toISOString(),
    };
  return {
    valid: true,
    payload: decoded.payload,
    status: enrollment.status,
    checkedInAt: enrollment.checkedInAt,
    session: getSession(enrollment.classId),
    checkedAt: new Date().toISOString(),
  };
}

/** Free POST /check-in/:token — mark a valid pass as used (door staff). */
export function checkIn(token: string) {
  const result = verifyPass(token);
  if (!result.valid || !result.payload) return result;
  const enrollment = store.getPass(result.payload.passId);
  if (!enrollment) return result;
  if (enrollment.status === "checked-in")
    return { ...result, alreadyCheckedIn: true };
  enrollment.status = "checked-in";
  enrollment.checkedInAt = new Date().toISOString();
  store.update(enrollment);
  return { ...result, status: enrollment.status, checkedInAt: enrollment.checkedInAt };
}

/** Free GET /roster/:classId — who is coming (names + seats, no contact data). */
export function roster(classId: string) {
  const session = getSession(classId);
  if (!session) throw new ClassError(404, "UNKNOWN_CLASS", `no session "${classId}"`);
  return {
    classId,
    name: session.name,
    date: session.date,
    time: session.time,
    capacity: session.capacity,
    seatsTaken: session.seatsTaken,
    seatsLeft: session.seatsLeft,
    seats: store
      .forClass(classId)
      .sort((a, b) => a.seatNumber - b.seatNumber)
      .map((e) => ({
        seatNumber: e.seatNumber,
        holder: e.holderName,
        status: e.status,
        checkedInAt: e.checkedInAt,
      })),
  };
}
