<script>
  import { createEventDispatcher } from "svelte";

  export let title;

  const dispatch = createEventDispatcher();

  function closeModal() {
    dispatch("close");
  }

  window.onkeydown = (e) => { if(e.key === "Escape") dispatch("close") }
</script>

<div class="modal-backdrop"/>
<div class="modal">
  <div class="modal-title">
    <h3>{title}</h3>
    <p class="close-btn" on:click={closeModal} style="font-family: sans-serif;">X</p>
  </div>

  <div class="content">
    <slot />
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100vh;
    background: rgba(0, 0, 0, 0.75);
    z-index: 10;
  }

  .modal {
    position: fixed;
    top: 10vh;
    left: 10%;
    width: 80%;
    /* max-height: 80vh; */
    background: white;
    border-radius: 5px;
    z-index: 100;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.26);
    /* overflow: scroll; */
  }

  .modal-title {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px solid var(--border-light-color);
  }

  .close-btn {
    cursor: pointer;
    margin: 1rem;
    font-weight: bold;
  }

  h3 {
    padding: 1rem;
    margin: 0;
    font-family: "Roboto Slab", sans-serif;
  }

  .content {
    padding: 1rem;
  }

  @media (min-width: 768px) {
    .modal {
      width: 80vw;
      
    }
  }
</style>
