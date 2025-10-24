import { chat } from "../alfred/llm.js";

async function testLLM() {
  const startTime = Date.now();
  let success = false;
  let errorMessage = "";
  let responseTime = 0;

  try {
    console.log("Testing LLM integration...");

    // Test basic functionality
    const response = await chat("Hello, can you respond with 'Test successful'?", {
      model: "gemini-2.0-flash",
      temperature: 0,
      max_tokens: 50,
      timeout_ms: 10000
    });

    responseTime = Date.now() - startTime;

    // Check response format
    if (typeof response === "string" && response.length > 0) {
      console.log("✓ Successful API connection");
      console.log("✓ Proper response format");
      console.log("✓ Basic functionality working");
      console.log(`Response: ${response}`);
      success = true;
    } else {
      throw new Error("Invalid response format");
    }

  } catch (error) {
    responseTime = Date.now() - startTime;
    errorMessage = error.message;
    console.error("✗ Error:", errorMessage);

    // Check for specific error types
    if (errorMessage.includes("Falta GEMINI_API_KEY")) {
      console.log("✗ API key not configured");
    } else if (errorMessage.includes("HTTP 401") || errorMessage.includes("invalid")) {
      console.log("✗ Invalid API key");
    } else if (errorMessage.includes("timeout") || errorMessage.includes("aborted")) {
      console.log("✗ Timeout occurred");
    } else {
      console.log("✗ Other error");
    }
  }

  console.log(`Response time: ${responseTime}ms`);
  console.log(`Success: ${success}`);
  if (errorMessage) console.log(`Error: ${errorMessage}`);

  return { success, responseTime, errorMessage };
}

// Test with invalid key (temporarily modify env)
async function testInvalidKey() {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "invalid_key";

  console.log("\nTesting invalid API key...");
  const result = await testLLM();

  // Restore
  process.env.GEMINI_API_KEY = originalKey;

  return result;
}

// Test timeout
async function testTimeout() {
  console.log("\nTesting timeout...");
  const startTime = Date.now();

  try {
    await chat("This should timeout", {
      timeout_ms: 1 // Very short timeout
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.log(`✓ Timeout handling: ${error.message.includes("aborted") ? "Working" : "Failed"}`);
    console.log(`Response time: ${responseTime}ms`);
  }
}

// Run all tests
async function runTests() {
  console.log("=== LLM Integration Test ===\n");

  const basicResult = await testLLM();
  const invalidKeyResult = await testInvalidKey();
  await testTimeout();

  console.log("\n=== Test Summary ===");
  console.log(`Basic test: ${basicResult.success ? "PASS" : "FAIL"} (${basicResult.responseTime}ms)`);
  console.log(`Invalid key test: ${invalidKeyResult.errorMessage.includes("400") || invalidKeyResult.errorMessage.includes("API_KEY_INVALID") ? "PASS" : "FAIL"}`);
}

runTests().catch(console.error);