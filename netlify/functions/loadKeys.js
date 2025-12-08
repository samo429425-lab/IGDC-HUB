import fs from "fs";

export const handler = async () => {
  try {
    const envPath = process.env.SERVER_ENV_PATH;
    const apiKeys = JSON.parse(fs.readFileSync(envPath, "utf8"));

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, keys: Object.keys(apiKeys) })
    };
  } catch (err) {
    return { statusCode: 500, body: err.toString() };
  }
};
