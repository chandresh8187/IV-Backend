const connections = new Map();
const activeChatConnections = new Map();

const connectUser = userId => {
  const id = Number(userId);
  if (id) connections.set(id, (connections.get(id) || 0) + 1);
};
const disconnectUser = userId => {
  const id = Number(userId);
  const count = (connections.get(id) || 0) - 1;
  if (count > 0) connections.set(id, count); else connections.delete(id);
};
const getOnlineUserIds = () => [...connections.keys()];
const enterChat = userId => {
  const id = Number(userId);
  if (id) activeChatConnections.set(id, (activeChatConnections.get(id) || 0) + 1);
};
const leaveChat = userId => {
  const id = Number(userId);
  const count = (activeChatConnections.get(id) || 0) - 1;
  if (count > 0) activeChatConnections.set(id, count); else activeChatConnections.delete(id);
};
const getActiveChatUserIds = () => [...activeChatConnections.keys()];

module.exports = { connectUser, disconnectUser, getOnlineUserIds, enterChat, leaveChat, getActiveChatUserIds };
