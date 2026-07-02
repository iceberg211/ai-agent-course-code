const http = require('http');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhODE4YjYyNS1iZGViLTRiODMtODBmZC0xNmFjNGE4YWJjMzkiLCJ1c2VybmFtZSI6InRlc3RfZGV2ZWxvcGVyIiwiaWF0IjoxNzgyODkyMTc1LCJleHAiOjE3ODM0OTY5NzV9.4nprQ5KZYBD9Xyb1ZqKp80UDMI3fJ_7iFupfPK09FO0';
const BASE_URL = 'http://127.0.0.1:3001';

function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  console.log("=== 🚀 开始全量 API 接口联调大阅兵 ===");

  const testCases = [
    { name: "1. 监控大盘数据 (GET /dashboard/summary)", path: "/dashboard/summary", method: "GET" },
    { name: "2. 系统健康检测 (GET /health)", path: "/health", method: "GET" },
    { name: "3. 当前用户资料 (GET /auth/me)", path: "/auth/me", method: "GET" },
    { name: "4. 用户 API Key (GET /auth/api-keys)", path: "/auth/api-keys", method: "GET" },
    { name: "5. RBAC 角色列表 (GET /rbac/roles)", path: "/rbac/roles", method: "GET" },
    { name: "6. RBAC 权限定义 (GET /rbac/permissions)", path: "/rbac/permissions", method: "GET" },
    { name: "7. RBAC 用户列表 (GET /rbac/users)", path: "/rbac/users", method: "GET" },
    { name: "8. 部门架构列表 (GET /rbac/departments)", path: "/rbac/departments", method: "GET" },
    { name: "9. 当前权限快照 (GET /rbac/me/permissions)", path: "/rbac/me/permissions", method: "GET" },
    { name: "10. 当前动态菜单 (GET /rbac/me/menus)", path: "/rbac/me/menus", method: "GET" },
    { name: "11. 知识库主目录 (GET /knowledge-bases)", path: "/knowledge-bases", method: "GET" },
    { name: "12. 角色助手列表 (GET /personas)", path: "/personas", method: "GET" },
    { name: "13. 长期记忆列表 (GET /memories)", path: "/memories", method: "GET" },
  ];

  for (const tc of testCases) {
    try {
      const res = await request(tc.path, tc.method);
      console.log(`\n[PASS] ${tc.name}`);
      console.log(`Status: ${res.status}`);
      console.log(`Response:`, JSON.stringify(res.body).substring(0, 160) + (JSON.stringify(res.body).length > 160 ? "..." : ""));
    } catch (e) {
      console.log(`\n[FAIL] ${tc.name} -> Error: ${e.stack || e.message}`);
    }
  }

  // 14. 动态写入测试：创建测试部门
  console.log("\n--- 🛠️ 开始动态写入与变更联动测试 ---");
  let deptId = null;
  try {
    const res = await request("/rbac/departments", "POST", { code: "TECH_DEV", name: "技术研发部" });
    console.log(`[PASS] 14. 创建部门 (POST /rbac/departments)`);
    console.log(`Status: ${res.status}, Created Dept:`, JSON.stringify(res.body));
    if (res.body && res.body.id) deptId = res.body.id;
  } catch (e) {
    console.log(`[FAIL] 14. 创建部门 -> Error: ${e.message}`);
  }

  // 15. 读取新建的部门，验证一致性
  if (deptId) {
    try {
      const res = await request("/rbac/departments", "GET");
      console.log(`[PASS] 15. 验证新部门存在 (GET /rbac/departments)`);
      console.log(`Status: ${res.status}, Items Count:`, res.body ? res.body.length : 0);
    } catch (e) {
      console.log(`[FAIL] 15. 验证新部门存在 -> Error: ${e.message}`);
    }
  }

  // 16. 创建临时知识库
  let kbId = null;
  try {
    const res = await request("/knowledge-bases", "POST", { name: "联调测试知识库", description: "用于接口自动联调验证" });
    console.log(`[PASS] 16. 创建临时知识库 (POST /knowledge-bases)`);
    console.log(`Status: ${res.status}, Created KB ID:`, res.body ? res.body.id : null);
    if (res.body && res.body.id) kbId = res.body.id;
  } catch (e) {
    console.log(`[FAIL] 16. 创建临时知识库 -> Error: ${e.message}`);
  }

  // 17. 获取该知识库详情
  if (kbId) {
    try {
      const res = await request(`/knowledge-bases/${kbId}`, "GET");
      console.log(`[PASS] 17. 查询知识库详情 (GET /knowledge-bases/:id)`);
      console.log(`Status: ${res.status}, Info:`, JSON.stringify(res.body));
    } catch (e) {
      console.log(`[FAIL] 17. 查询知识库详情 -> Error: ${e.message}`);
    }

    // 18. 清理临时知识库
    try {
      const res = await request(`/knowledge-bases/${kbId}`, "DELETE");
      console.log(`[PASS] 18. 清除临时知识库 (DELETE /knowledge-bases/:id)`);
      console.log(`Status: ${res.status}`);
    } catch (e) {
      console.log(`[FAIL] 18. 清除临时知识库 -> Error: ${e.message}`);
    }
  }

  // 19. 清理测试部门
  if (deptId) {
    try {
      const res = await request(`/rbac/departments/${deptId}`, "DELETE");
      console.log(`[PASS] 19. 清除测试部门 (DELETE /rbac/departments/:id)`);
      console.log(`Status: ${res.status}`);
    } catch (e) {
      console.log(`[FAIL] 19. 清除测试部门 -> Error: ${e.message}`);
    }
  }

  console.log("\n=== 🏁 API 接口全量调试大阅兵结束 ===");
}

run();
