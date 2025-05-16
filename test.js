const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "https://assignment-12-50161.web.app"],
  credentials: true,
  optionSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.w0mh3.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db("MatrimonyDB");
    const usersCollection = db.collection("users");
    const biodataCollection = db.collection("biodata");
    const favouritesCollection = db.collection("favourites");
    const dataCollection = db.collection("data");
    const successCollection = db.collection("success");
    const PaymentCollection = db.collection("save-payment-info");

    // verify admin middleware ****
    const verifyAdmin = async (req, res, next) => {
      // console.log('data from verifyToken middleware--->', req.user?.email)
      const email = req.user?.email;
      const query = { email };

      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "admin")
        return res.send({ admin: false });
      next();
    };

    // Generate jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // save or update a user in db
    app.post("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const query = { email };
        const user = req.body;

        // Check if the user exists in the database
        const isExist = await usersCollection.findOne(query);

        if (isExist) {
          return res.status(200).send(isExist); // User already exists
        }

        // Insert the new user with additional fields
        const result = await usersCollection.insertOne({
          ...user,
          role: "NormalUser",
          timestamp: Date.now(),
        });

        res.status(201).send(result);
      } catch (error) {
        console.error("Error in /users/:email route:", error);
        res.status(500).send({ message: "Internal Server Error", error });
      }
    });

    // manage user status and role
    app.patch("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user?.status === "Requested")
        return res
          .status(400)
          .send("You have already requested, wait for some time.");

      const updateDoc = {
        $set: {
          status: "Requested",
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc);
      console.log(result);
      res.send(result);
    });

    // update a user role
    app.patch("/user/role/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;
      const filter = { email };
      const updateDoc = {
        $set: { role, status: "Verified" },
      };
      const bioDataUpdateDoc = {
        $set: {
          type: "premium",
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      const bioDataResult = await biodataCollection.updateOne(
        filter,
        bioDataUpdateDoc
      );
      res.send(result);
    });

    // update a user role ********
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });

    // get all user data
    app.get("/all-users/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const search = req.query.search || "";
      const query = {
        email: { $ne: email },
        name: { $regex: search, $options: "i" },
      };
      try {
        const result = await usersCollection.find(query).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch users" });
      }
    });

    app.get("/users-info", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // admin verify
    app.get(
      "/users/admin/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params?.email;

        // console.log({ decodeemail: req.decoded.email });
        // console.log(req.user.email);
        if (email !== req.user.email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const query = { email: email };
        const user = await usersCollection.findOne(query);
        let admin = false;
        if (user) {
          admin = user?.role === "admin";
        }
        res.send({ admin });
      }
    );

    // Save a biodata in the database with dynamic biodataId
    app.post("/biodata", verifyToken, async (req, res) => {
      try {
        const biodata = req.body;

        // Get the last biodata ID
        const lastBiodata = await biodataCollection
          .find()
          .sort({ biodataId: -1 })
          .limit(1)
          .toArray();

        const lastId = lastBiodata.length > 0 ? lastBiodata[0].biodataId : 0;
        const newBiodataId = lastId + 1;

        // Create the new biodata with a dynamic ID
        const newBiodata = {
          ...biodata,
          biodataId: newBiodataId,
          createdAt: new Date(),
        };

        const result = await biodataCollection.insertOne(newBiodata);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error creating biodata:", error);
        res.status(500).send({ message: "Failed to create biodata", error });
      }
    });

    // get premium bio data
    app.get("/premium-biodata", async (req, res) => {
      const query = { type: "premium" };
      const result = await biodataCollection.find(query).toArray();
      res.send(result);
    });

    // get premium bio data
    app.get("/similar-biodata/:gender", async (req, res) => {
      const { gender } = req.params;

      // Find biodata with the same gender and limit the results to 3
      const result = await biodataCollection
        .find({ gender })
        .limit(4)
        .toArray();

      res.send(result);
    });

    // get all biodata from db
    app.get("/biodata", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // Extract filters from query parameters
      const { ageRange, gender, division } = req.query;

      // Build the filter query
      const filter = {};

      if (ageRange) {
        const [minAge, maxAge] = ageRange.split("-").map(Number);
        filter.age = { $gte: minAge, $lte: maxAge };
      }
      if (gender) {
        filter.category = gender;
      }
      if (division) {
        filter.permanentDivision = division;
      }

      // Fetch filtered data
      const result = await biodataCollection
        .find(filter)
        .skip(skip)
        .limit(limit)
        .toArray();

      const totalCount = await biodataCollection.countDocuments(filter);

      res.send({
        data: result,
        totalCount,
      });
    });

    // get a biodata by id
    app.get("/biodata/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await biodataCollection.findOne(query);
      res.send(result);
    });

    // get all biodata posted by a specific user
    app.get("/biodata-data/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      // Use findOne to get a single document instead of an array
      const result = await biodataCollection.findOne(query);
      res.send(result);
    });

    // update a biodata in db
    app.put("/biodata-edit/:id", async (req, res) => {
      const id = req.params.id;
      const bioData = req.body;
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...bioData,
        },
      };
      const result = await biodataCollection.updateOne(
        query,
        updateDoc,
        options
      );
      res.send(result);
    });

    // get all biodata posted by a specific user
    app.get("/biodata/view/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await biodataCollection.find(query).toArray();
      res.send(result);
    });

    // API route to handle POST favourites
    app.post("/favourites", async (req, res) => {
      const newData = req.body;
      const result = await favouritesCollection.insertOne(newData);
      res.send(result);
    });

    // get all biodata posted by a specific user
    app.get("/favourites/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await favouritesCollection.find(query).toArray();
      res.send(result);
    });

    // Cancel/delete an order
    app.delete("/orders/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await favouritesCollection.deleteOne(query);
      res.send(result);
    });

    // API route to handle POST favourites
    app.post("/data", async (req, res) => {
      const newData = req.body;
      const result = await dataCollection.insertOne(newData);
      res.send(result);
    });

    // get all biodata from db
    app.get("/data-info", async (req, res) => {
      const result = await dataCollection.find().toArray();
      res.send(result);
    });

    // get all biodata posted by a specific user
    app.get("/data/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { userEmail: email };
      const result = await dataCollection.find(query).toArray();
      res.send(result);
    });

    // Cancel/delete an order
    app.delete("/data-info/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const order = await dataCollection.findOne(query);
      if (order.status === "Approve")
        return res
          .status(409)
          .send("Cannot cancel once the product is Approve!");
      const result = await dataCollection.deleteOne(query);
      res.send(result);
    });

    // Manage plant quantity
    app.patch("/data-info/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status,
          },
        };
        const result = await dataCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to update order status" });
      }
    });

    // API route to handle POST success
    app.post("/success", async (req, res) => {
      const newData = req.body;
      const result = await successCollection.insertOne(newData);
      res.send(result);
    });

    // get all success from db
    app.get("/success", async (req, res) => {
      // Get the sort order from query parameters (default is ascending)
      const sortOrder = req.query.sortOrder === "descending" ? -1 : 1;

      try {
        const result = await successCollection
          .find()
          .sort({ marriageDate: sortOrder })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching success stories:", error);
        res.status(500).send({ error: "Failed to fetch success stories." });
      }
    });

    app.get("/success-stories", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const successStories = await successCollection.find().toArray();
        res.send(successStories);
      } catch (error) {
        console.error("Error fetching success stories:", error);
        res.status(500).send({ error: "Failed to fetch success stories." });
      }
    });

    // get a biodata by id
    app.get("/success-stories/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await successCollection.findOne(query);
      res.send(result);
    });

    // payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, "amount inside the intent");

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/save-payment-info", async (req, res) => {
      const { transactionId, amount, email } = req.body;

      // Save payment details in your database
      try {
        // Example: Save to a MongoDB collection
        await PaymentCollection.insertOne({
          transactionId,
          amount,
          email,
          date: new Date(),
        });
        res.send({
          success: true,
          message: "Payment info saved successfully!",
        });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Failed to save payment info!" });
      }
    });

    // admin stat
    app.get("/admin-stat", verifyToken, verifyAdmin, async (req, res) => {
      // Get total number of biodata
      const totalBiodata = await biodataCollection.estimatedDocumentCount();

      // Get numbers of male and female biodata
      const maleBiodataCount = await biodataCollection.countDocuments({
        gender: "male",
      });
      const femaleBiodataCount = await biodataCollection.countDocuments({
        gender: "female",
      });

      // Get numbers of premium biodata
      const premiumBiodataCount = await biodataCollection.countDocuments({
        type: "premium",
      });

      // Get total revenue from biodata contact request payments
      const paymentDetails = await PaymentCollection.aggregate([
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$amount" },
          },
        },
        {
          $project: {
            _id: 0,
            totalRevenue: 1,
          },
        },
      ]).next();

      res.send({
        totalBiodata,
        maleBiodataCount,
        femaleBiodataCount,
        premiumBiodataCount,
        totalRevenue: paymentDetails?.totalRevenue || 0,
      });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Matrimony Server..");
});

app.listen(port, () => {
  console.log(`Matrimony is running on port ${port}`);
});
