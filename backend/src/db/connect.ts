import mongoose from "mongoose";

// Opens ONE connection to MongoDB for the whole app.
// Mongoose keeps it open and shares it with every model, so we call this once at startup.
export async function connectToDatabase(uri: string): Promise<void> {
  // Only fields defined in a schema can be used in queries. A typo in a filter
  // like { parnetId: x } then matches nothing instead of silently matching everything.
  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    // If MongoDB is not running, give up after 5 seconds with a clear error
    // instead of waiting about 30 seconds (the default).
    serverSelectionTimeoutMS: 5000,
  });
}

export type DatabaseStatus = "connected" | "connecting" | "disconnected";

// Asks Mongoose how the connection is doing right now. Mongoose keeps a number:
// 1 = connected, 2 = connecting, anything else (0 disconnected, 3 disconnecting) = not usable.
// If MongoDB stops, Mongoose notices within about 10 seconds and keeps trying to reconnect.
export function getDatabaseStatus(): DatabaseStatus {
  switch (mongoose.connection.readyState) {
    case 1:
      return "connected";
    case 2:
      return "connecting";
    default:
      return "disconnected";
  }
}

// Closes the connection. Used when the server shuts down, and later by tests.
export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
}
