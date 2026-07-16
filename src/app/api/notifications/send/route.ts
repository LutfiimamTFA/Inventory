import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore, getAdminMessaging } from "@/lib/firebase-admin";

export const runtime = "nodejs";

/**
 * Kirim web push (FCM) ke semua token aktif milik recipientUid.
 *
 * Dokumen asset_notifications untuk in-app bell SUDAH dibuat oleh
 * createAssetNotification() di client (lib/notifications.ts) sebelum route
 * ini dipanggil — route ini hanya bertanggung jawab atas pengiriman push,
 * supaya tidak ada dokumen notifikasi dobel.
 *
 * Firebase Admin SDK & service account HANYA dipakai di sini (server),
 * tidak pernah diekspos ke client.
 */
export async function POST(req: NextRequest) {
  console.debug("[Notifications Send] route hit");

  let body: { recipientUid?: string; title?: string; message?: string; linkUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Payload tidak valid" }, { status: 400 });
  }

  const { recipientUid, title, message, linkUrl } = body;
  if (!recipientUid || !title || !message) {
    return NextResponse.json(
      { success: false, message: "recipientUid, title, message wajib diisi" },
      { status: 400 }
    );
  }

  const messaging = getAdminMessaging();
  const firestore = getAdminFirestore();
  if (!messaging || !firestore) {
    console.warn("[Notifications Send] Firebase Admin belum dikonfigurasi, push dilewati");
    return NextResponse.json({ success: true, sent: 0, message: "Push tidak dikonfigurasi" });
  }

  try {
    const tokensSnap = await firestore
      .collection("asset_notification_tokens")
      .where("uid", "==", recipientUid)
      .where("isActive", "==", true)
      .get();

    if (tokensSnap.empty) {
      console.debug("[Notifications Send] tidak ada token aktif untuk", recipientUid);
      return NextResponse.json({ success: true, sent: 0 });
    }

    let sent = 0;
    await Promise.all(
      tokensSnap.docs.map(async (tokenDoc) => {
        const token = tokenDoc.data().token as string;
        try {
          await messaging.send({
            token,
            notification: { title, body: message },
            webpush: {
              fcmOptions: linkUrl ? { link: linkUrl } : undefined,
              notification: { icon: "/logo.png" },
            },
          });
          sent += 1;
          await tokenDoc.ref.update({ lastUsedAt: new Date() });
        } catch (err) {
          console.error("[Notifications Send] token invalid, menonaktifkan", tokenDoc.id, err);
          await tokenDoc.ref.update({ isActive: false });
        }
      })
    );

    console.debug("[Notifications Send] push terkirim ke", sent, "device");
    return NextResponse.json({ success: true, sent });
  } catch (err) {
    console.error("[Notifications Send] error:", err);
    return NextResponse.json(
      { success: false, message: "Gagal mengirim push notification" },
      { status: 500 }
    );
  }
}
