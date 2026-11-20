import { createApp } from "vue";
import { greet } from "@ternent-fixtures/library";
import { CounterButton } from "@ternent-fixtures/vue-library";
import "@ternent-fixtures/vue-library/style.css";
createApp(CounterButton, { label: greet("Concord") }).mount("#app");
