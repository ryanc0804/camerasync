import { Router } from "express";
import { pool } from "../db/pool.js";

export const fileRouter = Router();


// TODO: handle getting files from S3 and routing through auth middleware
fileRouter.get("/get/:fileId", async (req, res) => {
    res.status(501).json({"message": "API not available"});
})


// Handle file uploads (locally for now S3 later)
fileRouter.post("/upload", async (req, res) => {

})