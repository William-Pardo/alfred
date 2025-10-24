import { chat } from "../alfred/llm.js";

async function testLLM() {
  const startTime = Date.now();
  let success = false;
  let errorMessage = "";
  let responseTime = 0;
  let providerUsed = "";

  try {
    console.log("Testing LLM integration with key rotation...");

    // Test basic functionality
    const response = await chat("Hello, can you respond with 'Test successful'?", {
      model: process.env.MODEL_PLAN || "meta-llama/llama-3-70b-instruct",
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
    if (errorMessage.includes("Falta") && errorMessage.includes("API_KEY")) {
      console.log("✗ API keys not configured");
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

  return { success, responseTime, errorMessage, providerUsed };
}

// Test with invalid key (temporarily modify env)
async function testInvalidKey() {
  const originalKeys = {
    openrouter: process.env.OPENROUTER_API_KEYS,
    groq: process.env.GROQ_API_KEYS,
    gemini: process.env.GEMINI_API_KEY
  };

  // Set all keys to invalid
  process.env.OPENROUTER_API_KEYS = "invalid_key";
  process.env.GROQ_API_KEYS = "invalid_key";
  process.env.GEMINI_API_KEY = "invalid_key";

  console.log("\nTesting invalid API key...");
  const result = await testLLM();

  // Restore
  process.env.OPENROUTER_API_KEYS = originalKeys.openrouter;
  process.env.GROQ_API_KEYS = originalKeys.groq;
  process.env.GEMINI_API_KEY = originalKeys.gemini;

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

// Test key rotation functionality
async function testKeyRotation() {
  console.log("\nTesting key rotation...");

  const results = [];
  const numTests = 5;

  for (let i = 0; i < numTests; i++) {
    try {
      const response = await chat(`Test message ${i + 1}`, {
        model: process.env.MODEL_PLAN || "meta-llama/llama-3-70b-instruct",
        temperature: 0,
        max_tokens: 20,
        timeout_ms: 5000
      });
      results.push({ success: true, response: response.substring(0, 50) });
      console.log(`✓ Test ${i + 1}: Success`);
    } catch (error) {
      results.push({ success: false, error: error.message });
      console.log(`✗ Test ${i + 1}: Failed - ${error.message.substring(0, 50)}`);
    }

    // Small delay between tests
    await new Promise(r => setTimeout(r, 100));
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`Key rotation test: ${successCount}/${numTests} successful`);

  return { results, successCount, totalTests: numTests };
}

// Test provider fallback
async function testProviderFallback() {
  console.log("\nTesting provider fallback...");

  // Temporarily modify env to test fallback
  const originalKeys = {
    openrouter: process.env.OPENROUTER_API_KEYS,
    groq: process.env.GROQ_API_KEYS,
    gemini: process.env.GEMINI_API_KEY
  };

  try {
    // Test with only Gemini available (remove OpenRouter keys)
    process.env.OPENROUTER_API_KEYS = "";
    process.env.GROQ_API_KEYS = "";
    // Keep Gemini key

    const response = await chat("Fallback test", {
      timeout_ms: 10000
    });

    console.log("✓ Provider fallback working");
    return { success: true };

  } catch (error) {
    console.log("✗ Provider fallback failed:", error.message.substring(0, 50));
    return { success: false, error: error.message };
  } finally {
    // Restore original keys
    process.env.OPENROUTER_API_KEYS = originalKeys.openrouter;
    process.env.GROQ_API_KEYS = originalKeys.groq;
    process.env.GEMINI_API_KEY = originalKeys.gemini;
  }
}

// Run all tests
async function runTests() {
  console.log("=== LLM Integration Test with Key Rotation ===\n");

  const basicResult = await testLLM();
  const invalidKeyResult = await testInvalidKey();
  await testTimeout();
  const rotationResult = await testKeyRotation();
  const fallbackResult = await testProviderFallback();

  console.log("\n=== Test Summary ===");
  console.log(`Basic test: ${basicResult.success ? "PASS" : "FAIL"} (${basicResult.responseTime}ms)`);
  console.log(`Invalid key test: ${invalidKeyResult.success ? "FAIL" : "PASS"}`);
  console.log(`Key rotation test: ${rotationResult.successCount}/${rotationResult.totalTests} successful`);
  console.log(`Provider fallback test: ${fallbackResult.success ? "PASS" : "FAIL"}`);
}

runTests().catch(console.error);