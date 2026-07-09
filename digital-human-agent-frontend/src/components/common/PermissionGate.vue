<template>
  <slot v-if="allowed" />
  <slot v-else name="fallback" />
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { usePermissions } from '@/hooks/usePermissions'

const props = defineProps<{
  code: string
}>()

const permissions = usePermissions()

const allowed = computed(() => permissions.can(props.code))

onMounted(() => {
  void permissions.loadPermissions()
})
</script>
