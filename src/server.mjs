import express from "express";
import routes from "../src/routes/index.mjs";

const app = express();
app.use(express.json());


const PORT = process.env.PORT || 3000;
app.use(routes);

app.get("/", (request, response) => {
  response.send("Welcome to 90 plus tutorial backend");
});



app.listen(PORT, () => {
  console.log(`Application now running on Port: ${PORT}`);
});
