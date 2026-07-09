<template>
  <section
    class="flex flex-col gap-4 p-5 bg-white/65 backdrop-blur-md border border-white/50 rounded-xl"
    :aria-label="label"
  >
    <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
      <slot />
    </div>
    <div v-if="$slots.actions" class="flex justify-end gap-2">
      <slot name="actions" />
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
  }>(),
  {
    label: '筛选面板',
  },
)
</script>
