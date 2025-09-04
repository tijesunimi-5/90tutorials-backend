import express from "express";
import routes from "../src/routes/index.mjs";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import { Data } from "./utils/data.mjs";
import passport from "passport";
import './strategies/local-strategy.mjs'

const app = express();
app.use(express.json());
app.use(cors());
app.use(
  session({
    secret: "tijesunimi",
    saveUninitialized: false, //this does not let random unregistered user data get saved
    resave: false,
    cookie: {
      maxAge: 60000 * 60, //1 hour
    },
  })
);
app.use(cookieParser());
app.use(passport.initialize())
app.use(passport.session())

const PORT = 3000;
app.use(routes);

app.get("/", (request, response) => {
  console.log(request.session);
  console.log(request.session.id);
  request.session.visited = true;
  // response.cookie('hello', 'world', { maxAge: 60000})
  response.send("Welcome to 90 plus tutorial backend");
});

app.listen(PORT, () => {
  console.log(`Application now running on Port: ${PORT}`);
});

//learning though
app.post("/api/auth", (request, response) => {
  const {
    body: { name, password },
  } = request;
  const findUser = Data.find((user) => user.name === name);
  if (findUser.password !== password || !findUser)
    return response.status(401).send({ msg: "BAD CREDENTIALS" });

  request.session.user = findUser;
  return response.status(200).send(findUser);
});

app.get("/api/auth/status", (request, response) => {
  request.sessionStore.get(request.sessionID, (res, session) => {
    console.log(session)
  })
  return request.session.user
    ? response.status(200).send(request.session.user)
    : response.status(401).send({ msg: "NOT AUTHENTICATED" });
});
