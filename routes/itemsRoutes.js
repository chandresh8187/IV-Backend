const express = require("express");

const {
  createItem,
  deleteItem,
  getItems,
  updateItem,
} = require("../controllers/itemsController");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authMiddleware, getItems);
router.post("/", authMiddleware, createItem);
router.put("/:id", authMiddleware, updateItem);
router.delete("/:id", authMiddleware, deleteItem);

module.exports = router;
