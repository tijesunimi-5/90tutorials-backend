import express from "express";
import routes from "../src/routes/index.mjs";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import passport from "passport";
import dotenv from 'dotenv'

dotenv.config()
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const allowedOrigins = [
  "http://localhost:3000",
  "https://90-tutorials.vercel.app",
];
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg =
          "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-New-Token"],
    credentials: true, // Crucial for passing cookies/session data
  })
);
app.use(
  session({
    secret: "tijesunimi",
    saveUninitialized: false, //this does not let random unregistered user data get saved
    resave: false,
    rolling: true,
    cookie: {
      maxAge: 4 * 60 * 60 * 1000, //4 hours
      secure: false,
      httpOnly: true,
    },
  })
);
app.use(cookieParser());
app.use(passport.initialize());
app.use(passport.session());

const PORT = 8000;
app.use("/api", routes);

app.get("/test-route-hit", (request, response) => {
  response.status(200).send("Main App Router is working!");
});

app.get("/", (request, response) => {
  console.log(request.sessionID);
  response.send("Welcome to 90 plus tutorial backend");
});

app.listen(PORT, () => {
  console.log(`Application now running on Port: ${PORT}`);
});
