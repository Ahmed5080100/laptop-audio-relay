const SERVER = "https://laptop-audio-relay.ethiodeploy.app";

const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const statusBox = document.getElementById("status");

let socket = null;
let peer = null;
let captureStream = null;
let audioContext = null;
let audioSource = null;
let isStarting = false;
let makingOffer = false;
let pendingCandidates = [];

function status(message) {
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
      console.error("ICE candidate error:", error);
    }
  }
}

async function createOffer() {
  if (!peer || makingOffer || peer.signalingState !== "stable") return;

  makingOffer = true;

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendSignal({
      type: "offer",
      sdp: peer.localDescription
    });
    status("تم الاتصال بالهاتف، جاري إرسال الصوت...");
  } catch (error) {
    console.error(error);
    status("تعذر إنشاء الاتصال: " + error.message);
  } finally {
    makingOffer = false;
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

  peer.onconnectionstatechange = () => {
    status("حالة الاتصال: " + peer.connectionState);
  };

  peer.ondatachannel = () => {};

  captureStream.getAudioTracks().forEach(track => {
    peer.addTrack(track, captureStream);
  });
}

async function handleSignal(message) {
  if (!peer) return;

  if (message.type === "peer-ready") {
    await createOffer();
  }

  if (message.type === "answer") {
    await peer.setRemoteDescription(message.sdp);
    await addPendingCandidates();
    status("تم توصيل الهاتف واستقبال الصوت...");
  }

  if (message.type === "candidate") {
    if (peer.remoteDescription) {
      try {
        await peer.addIceCandidate(message.candidate);
      } catch (error) {
        console.error("ICE candidate error:", error);
      }
    } else {
      pendingCandidates.push(message.candidate);
    }
  }
}

async function start() {
  if (isStarting) return;
  isStarting = true;

  startButton.disabled = true;
  status("جاري بدء الإرسال...");

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab || !tab.id) {
      throw new Error("لم يتم العثور على التبويب الحالي.");
    }

    captureStream = await new Promise((resolve, reject) => {
  chrome.tabCapture.capture(
    { audio: true, video: false },
    stream => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(stream);
      }
    }
  );
});

    if (!captureStream) {
      throw new Error("Chrome لم يتمكن من التقاط صوت التبويب.");
    }

    audioContext = new AudioContext();
    audioSource = audioContext.createMediaStreamSource(captureStream);
    audioSource.connect(audioContext.destination);

    createPeer();

    socket = new WebSocket(SERVER + "/signal");

    socket.onopen = () => {
      sendSignal({ type: "join", role: "laptop" });
      status("تم الاتصال بالخادم، في انتظار الهاتف...");
    };

    socket.onmessage = async event => {
      try {
        await handleSignal(JSON.parse(event.data));
      } catch (error) {
        console.error(error);
        status("خطأ أثناء الاتصال: " + error.message);
      }
    };

    socket.onerror = () => {
      status("تعذر الاتصال بالخادم. تحقق من رابط الخادم.");
    };

    socket.onclose = () => {
      if (captureStream) status("انقطع الاتصال بالخادم.");
    };

    stopButton.disabled = false;
  } catch (error) {
    console.error(error);
    status("خطأ: " + error.message);
    await stop();
  } finally {
    isStarting = false;
  }
}

async function stop() {
  if (socket) {
    socket.close();
    socket = null;
  }

  if (peer) {
    peer.close();
    peer = null;
  }

  if (captureStream) {
    captureStream.getTracks().forEach(track => track.stop());
    captureStream = null;
  }

  if (audioContext) {
    await audioContext.close().catch(() => {});
    audioContext = null;
  }

  audioSource = null;
  pendingCandidates = [];
  makingOffer = false;

  startButton.disabled = false;
  stopButton.disabled = true;
  status("تم إيقاف الإرسال.");
}

startButton.addEventListener("click", start);
stopButton.addEventListener("click", stop);
