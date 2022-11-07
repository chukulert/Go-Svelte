<script>
  export let controlType = null;
  export let id;
  export let label;
  export let rows = null;
  export let resize = false;
  export let value = "";
  export let type = "text";
  export let placeholder = "";
  export let valid = true;
  export let validityMessage = "";
  export let grouplist = [];
  export let readonly = false;
  export let disable = false;
  export let min = "0";

  let touched = false;
</script>

<div class="form-control">
  {#if label}
    <label for={id}>{label}</label>
  {/if}
  {#if controlType === "textarea"}
    <textarea
      class:invalid={!valid && touched}
      class={resize ? "textarea-resize" : ""}
      {rows}
      {id}
      {value}
      {placeholder}
      {readonly}
      disabled={disable}
      on:input
      on:blur={() => (touched = true)}
    />
  {/if}

  {#if controlType === "select"}
    <select
      class:invalid={!valid && touched}
      {id}
      {value}
      {placeholder}
      {readonly}
      on:input
      on:blur={() => (touched = true)}
    >
      {#each grouplist as group}
        <option value={group}>
          {group}
        </option>
      {/each}
    </select>
  {/if}
  {#if controlType === null}
    <input
      disabled={disable}
      class:invalid={!valid && touched}
      {type}
      {id}
      {value}
      {placeholder}
      {readonly}
      {min}
      on:input
      on:blur={() => (touched = true)}
    />
  {/if}
  {#if validityMessage && !valid && touched}
    <p class="error-message">{validityMessage}</p>
  {/if}
</div>

<style>
  input,
  textarea,
  select {
    display: block;
    width: 100%;
    font-family: sans-serif;
    border: none;
    border-bottom: 2px solid var(--border-light-color);
    border-radius: 3px 3px 0 0;
    background: white;
    padding: 0.15rem 0.25rem;
    transition: border-color 0.1s ease-out;
    font-size: 0.9rem;
  }

  textarea,
  select {
    border: 2px solid var(--border-light-color);
  }

  textarea {
    font-size: 0.8rem;
    overflow-y: scroll;
    resize: none;
    min-height: 4rem;
    max-height: 7.5rem;
  }

  input:focus,
  textarea:focus,
  select:focus {
    border-color: var(--main-dark-color);
    outline: none;
  }

  textarea::-webkit-input-placeholder {
    font-family: sans-serif;
  }

  label {
    font: sans-serif;
    font-weight: bold;
    display: block;
    margin-bottom: 0.5rem;
    width: 100%;
  }

  .form-control {
    padding: 0.5rem 0;
    width: 100%;
    margin: 0.25rem 0;
  }

  .invalid {
    border-color: var(--danger-color);
    background: #fde3e3;
  }

  .error-message {
    color: var(--danger-color);
    margin: 0.25rem 0;
  }
  .textarea-resize {
    resize: vertical;
  }
  input:disabled {
    cursor: not-allowed;
  }
</style>
