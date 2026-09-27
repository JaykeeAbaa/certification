import "server-only";
import nodemailer from "nodemailer";
import { lookup } from "node:dns/promises";
import { decrypt } from "./server";
export function publicIPv4(ip: string) {
  const p = ip.split(".").map(Number);
  return (
    p.length === 4 &&
    p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) &&
    ![0, 10, 127].includes(p[0]) &&
    p[0] < 224 &&
    !(p[0] === 169 && p[1] === 254) &&
    !(p[0] === 172 && p[1] >= 16 && p[1] <= 31) &&
    !(p[0] === 192 && p[1] === 168) &&
    !(p[0] === 100 && p[1] >= 64 && p[1] <= 127) &&
    !(p[0] === 198 && [18, 19].includes(p[1]))
  );
}
export async function transport(s: {
  host: string;
  port: number;
  email: string;
  secret: string;
}) {
  const addresses = await lookup(s.host, { family: 4, all: true });
  if (!addresses.length || addresses.some((a) => !publicIPv4(a.address)))
    throw new Error("SMTP host must resolve to a public IPv4 address.");
  return nodemailer.createTransport({
    host: addresses[0].address,
    port: s.port,
    secure: s.port === 465,
    requireTLS: true,
    tls: { servername: s.host, minVersion: "TLSv1.2" },
    auth: { user: s.email, pass: decrypt(s.secret) },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
