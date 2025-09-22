import { NextResponse } from "next/server";
import admin from "firebase-admin";

export const runtime = "nodejs"; // firebase-admin requires Node runtime

const FIVE_DAYS_IN_MS = 60 * 60 * 24 * 5 * 1000;

function makeCookieString(name, value, maxAgeSeconds) {
  const parts = [`${name}=${value}`, `Max-Age=${maxAgeSeconds}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function initAdmin() {
  if (admin.apps.length) return;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    // const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) });
    return;
  }

  if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PROJECT_ID) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
    return;
  }

  // Fallback to ADC (GOOGLE_APPLICATION_CREDENTIALS)
  admin.initializeApp();
}

export async function POST(request) {
  initAdmin();
  if (!admin.apps.length) {
    return NextResponse.json({ error: "firebase-admin not initialized" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const idToken = body?.idToken;
  if (!idToken) return NextResponse.json({ error: "Missing idToken" }, { status: 400 });

  try {
    // optional: verify token first (will throw on invalid/expired)
    await admin.auth().verifyIdToken(idToken);

    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn: FIVE_DAYS_IN_MS });
    const maxAge = Math.floor(FIVE_DAYS_IN_MS / 1000);
    const cookie = makeCookieString("__session", sessionCookie, maxAge);
    const res = NextResponse.json({ status: "ok" }, { status: 200 });
    res.headers.set("Set-Cookie", cookie);
    return res;
  } catch (err) {
    console.error("createSessionCookie error:", err);
    return NextResponse.json({ error: "UNAUTHORIZED", details: err.message || String(err) }, { status: 401 });
  }
}

export async function DELETE() {
  initAdmin();
  const cookie = makeCookieString("__session", "", 0);
  const res = NextResponse.json({ status: "cleared" }, { status: 200 });
  res.headers.set("Set-Cookie", cookie);
  return res;
}