const { Client } = require('pg');
const client = new Client({
  connectionString: "postgresql://postgres.godenpmwlpgqsvphccgf:Hewei187399692!@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
});

async function run() {
  await client.connect();
  const res = await client.query(
    "UPDATE app_user SET role = 'admin' WHERE username = 'test_developer' RETURNING *;"
  );
  console.log("Updated user:", res.rows[0]);
  await client.end();
}

run().catch(console.error);
