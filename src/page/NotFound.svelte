<script>
    import {navigate} from "svelte-routing";
    import Button from "../UI/Button.svelte";
</script>

<main class="page-container">
    <h2>Page not found</h2>
    <Button on:click={() => navigate("/dashboard")}>Return Home</Button>
</main>
