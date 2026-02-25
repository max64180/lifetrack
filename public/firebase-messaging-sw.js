importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDjtRsWiCnK0Y9mOPVia8VXovPJG_Jxc04",
  authDomain: "lifetrack-6f77d.firebaseapp.com",
  projectId: "lifetrack-6f77d",
  storageBucket: "lifetrack-6f77d.firebasestorage.app",
  messagingSenderId: "978713532459",
  appId: "1:978713532459:web:6bb257db2ee79760a9b26e",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "LifeTrack";
  const body = payload?.notification?.body || "";
  const link = payload?.fcmOptions?.link || payload?.data?.link || "/";
  self.registration.showNotification(title, {
    body,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { link },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.link || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
