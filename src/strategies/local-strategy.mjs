import passport from "passport";
import { Strategy } from "passport-local";
import { Data } from "../utils/data.mjs";

passport.serializeUser((user, done) => {
  done(null, user.id)
});

passport.deserializeUser((id, done) => {
  
})

export default passport.use(
  new Strategy({ usernameField: "email" }, (username, password, done) => {
    console.log(`Username: ${username}`);
    console.log(`Password: ${password}`);
    try {
      const findUser = Data.find((user) => user.email === username);
      if (!findUser) throw new Error("User not found");

      if (findUser.password !== password)
        throw new Error("Invalid Credentials");

      done(null, findUser);
    } catch (error) {
      done(error, null);
    }
  })
);
