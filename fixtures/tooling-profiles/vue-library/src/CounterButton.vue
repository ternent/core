<script setup lang="ts">
import { ref } from "vue";
defineProps<{ label: string }>();
const count = ref(0);
</script>

<template>
  <button class="pilot-counter" @click="count++">{{ label }}: {{ count }}</button>
</template>
