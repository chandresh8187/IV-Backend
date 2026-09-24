const express = require("express");

const {
  createItem,
  deleteItem,
  getItems,
  updateItem,
} = require("../controllers/itemsController");
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const router = express.Router();

router.get("/", authMiddleware, getItems);
router.post("/", authMiddleware, roleMiddleware([], "items.manage"), createItem);
router.put("/:id", authMiddleware, roleMiddleware([], "items.manage"), updateItem);
router.delete("/:id", authMiddleware, roleMiddleware([], "items.manage"), deleteItem);

module.exports = router;
