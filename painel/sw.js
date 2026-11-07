/* Service worker do painel de leads: mostra o aviso de lead novo no celular, mesmo com o painel fechado.
   O servidor manda o aviso por Web Push (push.ts) para todo mundo do time que tocou em "Ativar avisos". */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  var a = {};
  try { a = e.data ? e.data.json() : {}; } catch (x) { a = { corpo: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(a.titulo || "Lead novo", {
    body: a.corpo || "", icon: "/icone-192.png", badge: "/badge-96.png",
    tag: a.tag || "lead", renotify: true, data: { url: a.url || "/" },
  }));
});

/* toque no aviso: abre o painel (ou traz para a frente o que já está aberto) e atualiza a lista */
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (abertos) {
    for (var i = 0; i < abertos.length; i++) {
      if ("focus" in abertos[i]) { abertos[i].postMessage({ atualizar: true }); return abertos[i].focus(); }
    }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || "/");
  }));
});
