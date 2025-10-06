import passport from "passport";
import { Strategy } from "passport-local";
import { Data } from "../utils/data/data.mjs";
import { User } from "../schemas/user.mjs";
import { comparePassword } from "../utils/helpers/passwordValidation.mjs";

passport.serializeUser((user, done) => {
  console.log(`Inside Serialize User`);
  console.log(user);
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  console.log(`Inside Deserializer`);
  console.log(`Deserializing user id ${id}`);
  try {
    const findUser = await User.findById(id);
    if (!findUser) throw new Error("User Not Found");
    done(null, findUser);
  } catch (error) {
    done(error, null);
  }
});

export default passport.use(
  new Strategy({ usernameField: "email" }, async (username, password, done) => {
    console.log(`Username: ${username}`);
    console.log(`Password: ${password}`);
    try {
      const findUser = await User.findOne({ username });
      if (!findUser) throw new Error("User not found");

      if (!comparePassword(password, findUser.password))
        throw new Error("Bad Credentials");
      done(null, findUser);
    } catch (error) {
      done(error, null);
    }
  })
);
