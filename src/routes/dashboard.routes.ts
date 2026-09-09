import { Router, type Router as ExpressRouter } from "express";

const router: ExpressRouter = Router();

router.get("/", async (req, res) => {
  try {
    res.status(200).json({ message: "Dashboard route is working!" });
  } catch (error) {
    console.error("Error in dashboard route:", error);
    res.status(500).json({ message: "Internal server error" });
  }
})

export default router;