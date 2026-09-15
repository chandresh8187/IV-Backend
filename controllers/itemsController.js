const db = require("../config/db");

const normalizeItemName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ");

const parseItemId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const findItemById = async (id) => {
  const [items] = await db.query(
    `SELECT
       items.id,
       items.item_name,
       items.created_by,
       items.created_at,
       items.updated_at,
       users.name AS created_by_name
     FROM items
     LEFT JOIN users ON users.id = items.created_by
     WHERE items.id = ?
     LIMIT 1`,
    [id],
  );

  return items[0] || null;
};

const getItems = async (req, res) => {
  try {
    const [items] = await db.query(
      `SELECT
         items.id,
         items.item_name,
         items.created_by,
         items.created_at,
         items.updated_at,
         users.name AS created_by_name
       FROM items
       LEFT JOIN users ON users.id = items.created_by
       ORDER BY items.item_name ASC, items.id ASC`,
    );

    return res.json({
      success: true,
      message: "Items fetched successfully",
      data: items,
    });
  } catch (error) {
    console.error("getItems:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load items",
    });
  }
};

const createItem = async (req, res) => {
  try {
    const itemName = normalizeItemName(req.body?.item_name);

    if (!itemName) {
      return res.status(400).json({
        success: false,
        message: "Item name is required",
      });
    }

    if (itemName.length > 150) {
      return res.status(400).json({
        success: false,
        message: "Item name cannot exceed 150 characters",
      });
    }

    const [result] = await db.query(
      "INSERT INTO items (item_name, created_by) VALUES (?, ?)",
      [itemName, req.user.id],
    );
    const item = await findItemById(result.insertId);

    req.app.get("io")?.emit("items_updated", {
      action: "created",
      item,
    });

    return res.status(201).json({
      success: true,
      message: "Item added successfully",
      data: item,
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "An item with this name already exists",
      });
    }

    console.error("createItem:", error);
    return res.status(500).json({
      success: false,
      message: "Could not add item",
    });
  }
};

const updateItem = async (req, res) => {
  try {
    const id = parseItemId(req.params.id);
    const itemName = normalizeItemName(req.body?.item_name);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    if (!itemName) {
      return res.status(400).json({
        success: false,
        message: "Item name is required",
      });
    }

    if (itemName.length > 150) {
      return res.status(400).json({
        success: false,
        message: "Item name cannot exceed 150 characters",
      });
    }

    const existingItem = await findItemById(id);
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    await db.query(
      `UPDATE items
       SET item_name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [itemName, id],
    );
    const item = await findItemById(id);

    req.app.get("io")?.emit("items_updated", {
      action: "updated",
      item,
    });

    return res.json({
      success: true,
      message: "Item updated successfully",
      data: item,
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "An item with this name already exists",
      });
    }

    console.error("updateItem:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update item",
    });
  }
};

const deleteItem = async (req, res) => {
  try {
    const id = parseItemId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid item id",
      });
    }

    const item = await findItemById(id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const [result] = await db.query("DELETE FROM items WHERE id = ?", [id]);
    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    req.app.get("io")?.emit("items_updated", {
      action: "deleted",
      item: { id, item_name: item.item_name },
    });

    return res.json({
      success: true,
      message: "Item deleted successfully",
      data: { id },
    });
  } catch (error) {
    console.error("deleteItem:", error);
    return res.status(500).json({
      success: false,
      message: "Could not delete item",
    });
  }
};

module.exports = {
  createItem,
  deleteItem,
  getItems,
  normalizeItemName,
  parseItemId,
  updateItem,
};
