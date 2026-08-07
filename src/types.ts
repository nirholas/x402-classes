/** Shared types for x402-classes. */

export interface StudioInfo {
  name: string;
  description: string;
  timezone: string;
  address: string;
  phone: string;
}

/** A recurring class template from config/classes.json. */
export interface ClassTemplate {
  id: string;
  name: string;
  instructor: string;
  description: string;
  /** Lowercase weekday names this class runs on. */
  days: string[];
  time: string; // "HH:MM"
  durationMinutes: number;
  capacity: number;
  room: string;
}

export interface PassPolicy {
  seatPrice: string;
  description: string;
}

export interface ClassesConfig {
  studio: StudioInfo;
  scheduleWindowDays: number;
  /** Enrollment closes this many minutes before a session starts. */
  enrollmentClosesMinutes: number;
  classes: ClassTemplate[];
  passPolicy: PassPolicy;
}

/**
 * A concrete, bookable occurrence of a template.
 * `classId` is `<templateId>@<YYYY-MM-DD>` — stable and URL-safe.
 */
export interface Session {
  classId: string;
  templateId: string;
  name: string;
  instructor: string;
  description: string;
  room: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  endsAt: string; // HH:MM
  durationMinutes: number;
  capacity: number;
  seatsTaken: number;
  seatsLeft: number;
  enrollmentOpen: boolean;
  startsAt: string; // ISO
}

export interface Enrollment {
  passId: string;
  classId: string;
  templateId: string;
  seatNumber: number;
  holderName: string;
  email?: string;
  payerWallet?: string;
  issuedAt: string;
  expiresAt: string;
  status: "valid" | "checked-in";
  checkedInAt?: string;
}

/** The signed payload a QR pass carries. */
export interface PassPayload {
  passId: string;
  classId: string;
  seatNumber: number;
  holder: string;
  startsAt: string;
  expiresAt: string;
  studio: string;
}
