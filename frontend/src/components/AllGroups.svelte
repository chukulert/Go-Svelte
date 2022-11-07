<script>
  import { onMount } from "svelte";
  import { isEmpty } from "../utils/validation";
  import Button from "../UI/Button.svelte";
  import TextInput from "../UI/TextInput.svelte";

  let grouplist = [];
  let groupname = "";
  let editForm = false;

  let groupnameValid = false;

  $: groupnameValid = !isEmpty(groupname);

  onMount(() => {
    getAllGroups();
  });

  async function getAllGroups() {
    const url = "http://localhost:8080/fetchgroups";
    fetch(url)
      .then((response) => response.json())
      .then((data) => {
        const dataArr = data.map((grp) => grp.groupname);
        grouplist = dataArr;
      })
      .catch((error) => {
        console.log(error);
      });
  }

  const createGroup = (e) => {
    e.preventDefault();
    if (!groupname.length) {
      alert("Group name cannot be empty.");
      return;
    }
    const url = "http://localhost:8080/creategroup";
    fetch(url, {
      method: "POST",
      body: JSON.stringify({
        groupname: groupname,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        alert(data[0].Message);
        groupname = "";
        getAllGroups();
      })
      .catch((error) => {
        console.log(error);
      });
  };

  const toggleEditForm = () => {
    editForm = !editForm;
  };
</script>

<main>
  <div class="page-container">
    {#if editForm}
      <form on:submit|preventDefault={createGroup} class="add-group">
        <TextInput
          id="groupname"
          label="Group name"
          placeholder="Enter group name"
          value={groupname}
          on:input={(e) => (groupname = e.target.value)}
        />
        <div class="create-group-btn">
          <div>
            <Button type="submit" mode="outline">Add Group</Button>
          </div>
          <div>
            <Button on:click={toggleEditForm} mode="outline">Close</Button>
          </div>
        </div>
      </form>
    {:else}
      <div class="createDiv">
        <Button on:click={toggleEditForm}>Create Group</Button>
      </div>
    {/if}

    <table>
      <thead>
        <tr>
          <th>S/N</th>
          <th>Name</th>
        </tr>
      </thead>
      <tbody>
        {#each grouplist as group, i}
          <tr class={i % 2 === 0 && "alt-row"}>
            <td>{i + 1}</td>
            <td>{group}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</main>

<style>
  table,
  tr,
  td,
  th {
    font-family: sans-serif;
    table-layout: auto;
    text-align: center;
    border-collapse: collapse;
  }

  table {
    box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.26);
  }

  th {
    background-color: var(--main-dark-color);
    color: var(--font-light-color);
  }

  td {
    min-width: 15vw;
    padding: 0 0.5rem;
  }

  .page-container {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    width: 100%;
  }

  .createDiv {
    width: 100vw;
    padding-top: 15px;
    padding-bottom: 15px;
    display: flex;
    justify-content: center;
  }

  .add-group {
    font-family: sans-serif;
    display: flex;
    justify-content: center;
    column-gap: 1rem;
    width: 50%;
    padding: 0.5rem 2rem;
  }

  .create-group-btn {
    width: 100%;
    bottom: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .create-group-btn > * {
    margin: 0.5rem;
  }

  .alt-row {
    background-color: var(--background-light-color);
  }
</style>
