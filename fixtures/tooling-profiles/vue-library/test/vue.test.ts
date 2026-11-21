import { expect, test } from "vite-plus/test";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import CounterButton from "../src/CounterButton.vue";

test("the component renders its typed label and initial count", async () => {
  const html = await renderToString(createSSRApp(CounterButton, { label: "Concord" }));
  expect(html).toContain("Concord: 0");
  expect(html).toContain('class="pilot-counter"');
});
