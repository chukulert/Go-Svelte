
<script>
    import {navigate} from "svelte-routing";
    import Button from "../UI/Button.svelte";
    import { onMount } from "svelte";

    let check = false;
    onMount(()=>{
        if(sessionStorage.getItem("JWT")){
            check = true;
        }
    })
</script>

<main class="page-container">
    <h2>Page not found</h2>
    {#if check}
    <Button on:click={() =>   window.location.replace("/dashboard")}>Return Dashboard</Button>
    {:else}
    <Button on:click={() => window.location.replace("/")}>Return LoginPage</Button>
    {/if}
</main>
