<script>
  export let mode; //mode options = "outline", "danger"
  export let size; //size options= "sm"
  export let disabled = false;
  export let type = "button";
  export let id;
</script>

<button id={id} class={`${mode} ${size}`} type={type} on:click on:submit disabled = {disabled}>
  <slot />
</button>

<style>
  button {
    font: sans-serif;
    border: 1px solid var(--main-color);
    background: var(--main-color);
    padding: 0.5rem 1rem;
    color: var(--font-light-color);
    border-radius: 5px;
    box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.26);
    cursor: pointer;
    text-decoration: none;
  }

  button:focus {
    outline: none;
  }

  button:hover,
  button:active {
    background: var(--main-light-color);
    border-color: var(--main-light-color);
    box-shadow: 1px 1px 8px rgba(77, 51, 51, 0.26);
  }

  button:disabled,
  button:disabled:hover,
  button:disabled:active {
    background: #ccc;
    border-color: #ccc;
    color: #959595;
    box-shadow: none;
    cursor: not-allowed;
  }

  .sm {
    padding: 0.2rem 0.4rem;
    font-size: 0.8rem;
  }

  .outline {
    background: transparent;
    color: var(--main-color);
    box-shadow: none;
  }

  .outline:hover,
  .outline:active {
    background: var(--main-color);
    box-shadow: none;
    color: var(--font-light-color);
  }

  .outline:disabled,
  .outline:disabled:hover,
  .outline:disabled:active {
    background: transparent;
    color: #ccc;
  }

  .danger {
    background: var(--danger-color);
    color: var(--font-light-color);
    box-shadow: none;
    border: 1px solid var(--danger-color);
  }

  .danger:hover,
  .danger:active {
    background: var(--danger-color);
    opacity: 0.8;
    box-shadow: none;
    color: var(--font-light-color);
    border: 1px solid var(--danger-color);
  }

  .danger:disabled,
  .danger:disabled:hover,
  .danger:disabled:active {
    background: transparent;
    color: #ccc;
  }
</style>
