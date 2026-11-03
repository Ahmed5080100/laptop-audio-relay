const SERVER = window.location.origin;

const connectButton = document.getElementById("connect");
const remoteAudio = document.getElementById("remoteAudio");
const statusBox = document.getElementById("status");

let socket = null;
let peer = null;
let pendingCandidates = [];
let connecting = false;

function setStatus(message) {
  statusBox.textContent = "الحالة: " + message;
}

function sendSignal(data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

async function addPendingCandidates() {
  if (!peer || !peer.remoteDescription) return;

  const candidates = pendingCandidates;
  pendingCandidates = [];

  for (const candidate of candidates) {
    try {
      await peer.addIceCandidate(candidate);
    } catch (error) {
      console.error("ICE error:", error);
    }
  }
}

function createPeer() {
  peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });

  peer.onicecandidate = event => {
    if (event.candidate) {
      sendSignal({
        type: "candidate",
        candidate: event.candidate
      });
    }
  };

  peer.ontrack = event => {
    remoteAudio.srcObject = event.streams[0];

    remoteAudio.play().then(() => {
      setStatus("الصوت يعمل الآن على الهاتف.");
    }).catch(() => {
      setStatus("اضغط تشغيل في مشغل الصوت للسماع.");
    });
  };

  peer.onconnectionstatechange = () => {
    setStatus("حالة الاتصال: " + peer.connectionState);
  };
}

async function handleSignal(message) {
  if (message.type === "offer") {
    if (!peer) createPeer();

    await peer.setRemoteDescription(message.sdp);
    await addPendingCandidates();

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    sendSignal({
      type: "answer",
      sdp: peer.localDescription
    });

    setStatus("تم استقبال الاتصال، جاري تشغيل الصوت...");
  }

  if (message.type === "candidate") {
    if (peer && peer.remoteDescription) {
      try {
        await peer.addIceCandidate(message.candidate);
      } catch (error) {
        console.error("ICE error:", error);
      }
    } else {
      pendingCandidates.push(message.candidate);
    }
  }

  if (message.type === "peer-disconnected") {
    setStatus("انقطع اتصال الكمبيوتر.");
  }

  if (message.type === "error") {
    setStatus("خطأ: " + message.message);
  }
}

async function connect() {
  if (connecting) return;
  connecting = true;
  connectButton.disabled = true;

  try {
    createPeer();

    socket = new WebSocket(
      SERVER.replace(/^http/, "ws") + "/signal"
    );

    socket.onopen = () => {
      sendSignal({
        type: "join",
        role: "phone"
      });

      setStatus("تم الاتصال بالخادم، في انتظار الكمبيوتر...");
    };

    socket.onmessage = async event => {
      try {
        await handleSignal(JSON.parse(event.data));
      } catch (error) {
        console.error(error);
        setStatus("خطأ أثناء الاتصال: " + error.message);
      }
    };

    socket.onerror = () => {
      setStatus("تعذر الاتصال بالخادم.");
    };

    socket.onclose = () => {
      setStatus("انقطع الاتصال بالخادم.");
      connectButton.disabled = false;
      connecting = false;
    };

  } catch (error) {
    console.error(error);
    setStatus("خطأ: " + error.message);
    connectButton.disabled = false;
    connecting = false;
  }
}

connectButton.addEventListener("click", connect);
