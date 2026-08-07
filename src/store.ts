import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Enrollment } from "./types.js";

/**
 * File-backed persistence. State lives in data/enrollments.json so a restart
 * never loses a sold seat. No database required.
 */

const DATA_DIR = process.env.DATA_DIR ?? "data";
const ENROLLMENTS_FILE = `${DATA_DIR}/enrollments.json`;

function load<T>(file: string, fallback: T): T {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    // corrupt file — start fresh rather than crash
  }
  return fallback;
}

function save(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

export class Store {
  private enrollments: Enrollment[] = load<Enrollment[]>(ENROLLMENTS_FILE, []);

  forClass(classId: string): Enrollment[] {
    return this.enrollments.filter((e) => e.classId === classId);
  }

  seatsTaken(classId: string): number {
    return this.forClass(classId).length;
  }

  /** Lowest unused seat number, so cancelled seats get reused. */
  nextSeat(classId: string, capacity: number): number | null {
    const taken = new Set(this.forClass(classId).map((e) => e.seatNumber));
    for (let n = 1; n <= capacity; n++) if (!taken.has(n)) return n;
    return null;
  }

  getPass(passId: string): Enrollment | undefined {
    return this.enrollments.find((e) => e.passId === passId);
  }

  add(e: Enrollment): void {
    this.enrollments.push(e);
    save(ENROLLMENTS_FILE, this.enrollments);
  }

  update(e: Enrollment): void {
    const i = this.enrollments.findIndex((x) => x.passId === e.passId);
    if (i >= 0) this.enrollments[i] = e;
    save(ENROLLMENTS_FILE, this.enrollments);
  }

  /** Used to roll back a seat when payment settlement fails. */
  remove(passId: string): void {
    this.enrollments = this.enrollments.filter((e) => e.passId !== passId);
    save(ENROLLMENTS_FILE, this.enrollments);
  }
}

export const store = new Store();
