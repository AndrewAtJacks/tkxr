<script lang="ts">
  import '../app.css';
  import { theme } from '../lib/theme';
  // Import triggers side-effect: applies stored theme to <html>.
  $theme;
</script>

<slot />
