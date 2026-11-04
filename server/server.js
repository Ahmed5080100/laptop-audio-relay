const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
  noServer: true
});

const PORT = process.env.PORT || 3000;

// صفحة استقبال الصوت على الهاتف
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// عميل واحد للكمبيوتر وعميل واحد للهاتف
const clients = {
  laptop: null,
  phone: null
};

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(
    request.url,
    `http://${request.headers.host}`
  ).pathname;

  if (pathname !== "/signal") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit("connection", ws, request);
  });
});

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function notifyReady() {
  if (clients.laptop && clients.phone) {
    send(clients.laptop, { type: "peer-ready" });
    send(clients.phone, { type: "peer-ready" });
  }
}

wss.on("connection", ws => {
  ws.role = null;

  ws.on("message", rawMessage => {
    let message;

    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      send(ws, {
        type: "error",
        message: "Invalid message"
      });
      return;
    }

    // تسجيل الجهاز
    if (message.type === "join") {
      const role = message.role;

      if (role !== "laptop" && role !== "phone") {
        send(ws, {
          type: "error",
          message: "Invalid device role"
        });
        return;
      }

      // إغلاق اتصال سابق لنفس الدور
      const oldClient = clients[role];

      if (oldClient && oldClient !== ws) {
        send(oldClient, {
          type: "error",
          message: "Another device replaced this connection"
        });

        oldClient.close();
      }

      ws.role = role;
      clients[role] = ws;

      send(ws, {
        type: "joined",
        role
      });

      notifyReady();
      return;
    }

    if (!ws.role) {
      send(ws, {
        type: "error",
        message: "Join before sending messages"
      });
      return;
    }

    // تحديد الجهاز الآخر
    const targetRole =
      ws.role === "laptop" ? "phone" : "laptop";

    const target = clients[targetRole];

    if (!target || target.readyState !== WebSocket.OPEN) {
      return;
    }

    // تمرير رسائل WebRTC فقط
    const allowedTypes = [
      "offer",
      "answer",
      "candidate"
    ];

    if (allowedTypes.includes(message.type)) {
      send(target, message);
    }
  });

  ws.on("close", () => {
    if (ws.role && clients[ws.role] === ws) {
      clients[ws.role] = null;

      const otherRole =
        ws.role === "laptop" ? "phone" : "laptop";

      send(clients[otherRole], {
        type: "peer-disconnected"
      });
    }
  });

  ws.on("error", error => {
    console.error("WebSocket error:", error.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Audio relay server running on port ${PORT}`);
});
