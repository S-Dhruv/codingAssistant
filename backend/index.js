import express, { json } from "express";
import { connect } from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { createServer } from "http";
import authRoutes from "./routes/authRoutes.js";
import { rooms, users } from "./sharedState/sharedState.js";
import roomRoutes from "./routes/roomRoutes.js";
import Quiz from "./models/Quiz.js"; // Fixed casing to match actual file
import nodemailer from "nodemailer";
dotenv.config();

const app = express();
app.use(json());
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors({ origin: "*" }));

//mongoDB connection
const connectDB = async () => {
  try {
    const conn = await connect(process.env.MONGO_URI);
    console.log(`Database connected, ${conn.connection.id}`);
  } catch {
    console.error("Error connecting to database");
  }
};
let timeOnline = {};
let connections = {};
//Routes
app.use("/", authRoutes);
app.use("/", roomRoutes);
io.on("connection", (socket) => {
  console.log("Client connected with id:", socket.id);

  socket.on("join-room", ({ roomCode, userId }) => {
    try {
      socket.join(roomCode);
      socket.roomCode = roomCode;

      // Track users
      if (!rooms[roomCode]) rooms[roomCode] = [];
      if (!rooms[roomCode].includes(userId)) rooms[roomCode].push(userId);
      users[userId] = roomCode;

      // Track socket connections
      if (!connections[roomCode]) connections[roomCode] = [];
      if (!connections[roomCode].includes(socket.id)) {
        connections[roomCode].push(socket.id);
      }

      timeOnline[socket.id] = new Date();
      io.to(roomCode).emit("user-joined", socket.id, connections[roomCode]);
      console.log(`User ${userId} joined room ${roomCode}`);
    } catch (error) {
      console.error("Error in join-room:", error);
    }
  });

  // Signaling for WebRTC
  socket.on("signal", ({ roomCode, message, toId }) => {
    try {
      if (toId) {
        io.to(toId).emit("signal", socket.id, message);
      } else {
        socket.to(roomCode).emit("signal", socket.id, message);
      }
    } catch (error) {
      console.error("Error in signal:", error);
    }
  });

  // Collaborative cursor broadcasting
  socket.on("cursor-position", ({ userId, position }) => {
    try {
      const room = socket.roomCode;
      if (room && userId && position) {
        socket.to(room).emit("cursor-position", { userId, position });
      }
    } catch (error) {
      console.error("Error in cursor-position:", error);
    }
  });

  // Handle editor changes
  socket.on("editor", ({ change, code }) => {
    try {
      io.to(code).emit("editor", change);
    } catch (error) {
      console.error("Error in editor:", error);
    }
  });

  // Handle text messages
  socket.on("text-message", ({ message, client, code }) => {
    try {
      io.to(code).emit("text-message", { message, client });
    } catch (error) {
      console.error("Error in text-message:", error);
    }
  });

  // Handle leaving a room
  socket.on("leave-room", ({ code, client }) => {
    try {
      if (rooms[code]) {
        rooms[code] = rooms[code].filter((id) => id !== client);
        delete users[client];
        socket.leave(code);
        console.log(`User ${client} left room ${code}`);
      }
    } catch (error) {
      console.error("Error in leave-room:", error);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    try {
      for (const room in connections) {
        if (connections[room].includes(socket.id)) {
          connections[room] = connections[room].filter(
            (id) => id !== socket.id
          );
          io.to(room).emit("user-left", socket.id);
          console.log(`Notified room ${room} about user ${socket.id} leaving`);
        }
      }
      delete timeOnline[socket.id];
    } catch (error) {
      console.error("Error in disconnect:", error);
    }
  });
});

// Import the Quiz model

app.post("/api/save-quiz", async (req, res) => {
  try {
    const { roomCode, quizData } = req.body;

    // Validate received data
    if (!roomCode || !Array.isArray(quizData)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid JSON format" });
    }

    for (const question of quizData) {
      if (
        typeof question.question !== "string" ||
        !Array.isArray(question.options) ||
        question.options.length < 2 ||
        typeof question.correctAnswer !== "number" ||
        question.correctAnswer < 0 ||
        question.correctAnswer >= question.options.length
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid question format" });
      }
    }

    // Save to DB
    let existingQuiz = await Quiz.findOne({ roomCode });
    if (existingQuiz) {
      existingQuiz.quizData = quizData;
      await existingQuiz.save();
    } else {
      await Quiz.create({ roomCode, quizData });
    }

    res.json({ success: true, message: "Quiz saved successfully!" });
  } catch (error) {
    console.error("Error saving quiz:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// API to Fetch Quiz
app.post("/api/get-quiz", async (req, res) => {
  const { roomCode } = req.body;
  try {
    const quiz = await Quiz.findOne({ roomCode: roomCode });
    if (!quiz) {
      return res
        .status(404)
        .json({ success: false, message: "Quiz not found" });
    }
    res.json({ success: true, quizData: quiz.quizData });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching quiz" });
  }
});

app.post("/results", async (req, res) => {
  try {
    const { userId, roomCode, score, totalQuestions, answers } = req.body;

    const newResult = new Result({
      userId,
      roomCode,
      score,
      totalQuestions,
      answers,
    });

    await newResult.save();
    res.json({ message: "Results saved successfully!" });
  } catch (error) {
    res.status(500).json({ message: "Error saving results", error });
  }
});

// Nodemailer configuration
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "theguywhoapproves@gmail.com",
    pass: "bkpt okmx dkfh frmu",
  },
});

// Add this before the server.listen
app.post("/send-code", async (req, res) => {
  const { roomCode, email } = req.body;
  console.log(roomCode, email);
  try {
    const mailOptions = {
      from: "theguywhoapproves@gmail.com",
      to: email,
      subject: "Your Room Code for CodeCollab",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4F46E5;">Welcome to CodeCollab!</h2>
          <p>Here is your room code to join the collaborative coding session:</p>
          <div style="background-color: #1F2937; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="color: #fff; margin: 0;">Room Code: ${roomCode}</h3>
          </div>
          <p>You can use this code to join the room and start coding with your team.</p>
          <p>Happy coding!</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: "Email sent successfully" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ message: "Error sending email" });
  }
});

server.listen(5000, (err) => {
  if (err) {
    console.error("Error starting server:", err);
    return;
  }
  connectDB();
  console.log("Server is listening on port 5000!");
});
