import { Router } from "express";
import { pool } from "../db/pool.js";

export const authRouter  = Router();


//TODO: Handle server-side cookies
//TODO: Handle database query of users for all CRUD functions (parameterize!)
authRouter.post("/login", async(req, res) => {
    const {email, password} = req.body;

    console.log(email)
    console.log(password)
    res.status(200).json({token: "1234", user: email})
})

authRouter.post("/register", async(req, res) => {
    const {name, email, password} = req.body;

    res.status(400).json({"error": "Bad Request"})
})

authRouter.post("/logout", async(req, res) => {
    const {token, user_key} = req.body;

    res.status(400).json({"error": "Bad Request"})
})