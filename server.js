import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = createServer(app);

const PORT = process.env.PORT || 3001;

// Remove trailing slash if present
const CLIENT_URL = (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");

console.log("🌐 CLIENT_URL:", CLIENT_URL);

// Allowed origins (with and without trailing slash)
const allowedOrigins = [
  CLIENT_URL,
  `${CLIENT_URL}/`,
  "http://localhost:5173",
  "http://localhost:5173/",
];

// CORS for Express
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    // Remove trailing slash for comparison
    const normalizedOrigin = origin.replace(/\/$/, "");
    const normalizedAllowed = allowedOrigins.map(o => o.replace(/\/$/, ""));
    
    if (normalizedAllowed.includes(normalizedOrigin)) {
      callback(null, true);
    } else {
      console.log("❌ Blocked origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST"],
  credentials: true
}));

// CORS for Socket.io
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      
      const normalizedOrigin = origin.replace(/\/$/, "");
      const normalizedAllowed = allowedOrigins.map(o => o.replace(/\/$/, ""));
      
      if (normalizedAllowed.includes(normalizedOrigin)) {
        callback(null, true);
      } else {
        console.log("❌ Socket blocked origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Health check
app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "ScreenMeet server running",
    allowedOrigin: CLIENT_URL 
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

/* ═══════════════════════════════════
   Room Management
═══════════════════════════════════ */
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  socket.on("create-room", ({ roomId, config, hostName }) => {
    if (rooms.has(roomId)) {
      return socket.emit("error-msg", { message: "Room already exists." });
    }

    rooms.set(roomId, {
      hostId: socket.id,
      hostName,
      config,
      participant: null,
    });

    socket.join(roomId);
    socket.roomId = roomId;
    socket.role = "host";

    socket.emit("room-created", { roomId, config });
    console.log(`🏠 Room created: ${roomId} by ${hostName}`);
  });

  socket.on("join-room", ({ roomId, participantName }) => {
    const room = rooms.get(roomId);

    if (!room) {
      return socket.emit("error-msg", { message: "Room not found." });
    }
    if (room.participant) {
      return socket.emit("error-msg", { message: "Room is full." });
    }

    room.participant = { id: socket.id, name: participantName };
    socket.join(roomId);
    socket.roomId = roomId;
    socket.role = "participant";

    socket.emit("room-joined", {
      roomId,
      config: room.config,
      hostName: room.hostName,
    });

    socket.to(roomId).emit("participant-joined", { participantName });
    console.log(`👤 ${participantName} joined room: ${roomId}`);
  });

  socket.on("ready", ({ roomId }) => {
    socket.to(roomId).emit("participant-ready");
  });

  socket.on("offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("offer", { offer });
  });

  socket.on("answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("answer", { answer });
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", { candidate });
  });

  socket.on("screen-share-started", ({ roomId, streamId, hasAudio }) => {
    socket.to(roomId).emit("screen-share-started", { streamId, hasAudio });
  });

  socket.on("screen-share-stopped", ({ roomId }) => {
    socket.to(roomId).emit("screen-share-stopped");
  });

  socket.on("media-state", ({ roomId, isMicOn }) => {
    socket.to(roomId).emit("media-state", { isMicOn });
  });

  socket.on("leave-room", () => {
    handleDisconnect(socket);
  });

  socket.on("disconnect", () => {
    handleDisconnect(socket);
  });

  function handleDisconnect(socket) {
    const { roomId, role } = socket;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (role === "host") {
      socket.to(roomId).emit("host-left");
      rooms.delete(roomId);
      console.log(`🏠 Room deleted: ${roomId}`);
    } else if (role === "participant") {
      room.participant = null;
      socket.to(roomId).emit("participant-left");
      console.log(`👤 Participant left room: ${roomId}`);
    }

    socket.leave(roomId);
    console.log("❌ Disconnected:", socket.id);
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Accepting connections from: ${CLIENT_URL}`);
});