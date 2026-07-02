const { Client } = require('pg');
const client = new Client({
  connectionString: "postgresql://postgres.godenpmwlpgqsvphccgf:Hewei187399692!@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT id, username, role, department FROM app_user LIMIT 10;");
  console.log("Existing users in DB:", res.rows);
  await client.end();
}

run().catch(console.error);
