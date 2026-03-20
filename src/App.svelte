<script lang="ts">
  import OverlayApp from './lib/components/OverlayApp.svelte'
  import ToolbarApp from './lib/components/ToolbarApp.svelte'

  export let windowLabel: string
</script>

{#if windowLabel === 'overlay'}
  <OverlayApp />
{:else}
  <ToolbarApp />
{/if}
