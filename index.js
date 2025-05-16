const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const port = process.env.PORT || 5000;
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.w0mh3.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create MongoClient
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Global variable for collection
let bikesCollection;

async function run() {
  try {
    //Connect to MongoDB
    await client.connect();

    // Get Database & Collection
    const db = client.db("HunterDB");
    bikesCollection = db.collection("bikes");

    //Confirm connection
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB successfully!");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}
run().catch(console.dir);

// POST route to insert new bike
app.post("/bikes", async (req, res) => {
  const newData = req.body;
  try {
    const result = await bikesCollection.insertOne(newData);
    console.log("Inserted:", result);
    res.send(result);
  } catch (error) {
    console.error("Insert error:", error);
    res.status(500).send({ error: "Failed to insert bike data." });
  }
});

// GET route to fetch all bikes
app.get("/bike", async (req, res) => {
  try {
    const result = await bikesCollection.find().toArray();
    res.send(result);
  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).send({ error: "Failed to fetch bike data." });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send("Hunter server is running 🚴");
});

// Start server
app.listen(port, () => {
  console.log(`Hunter server is running on port: ${port}`);
});
