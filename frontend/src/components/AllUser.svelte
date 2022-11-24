<script>
  import { onMount } from "svelte";
  import EditUser from "../components/EditUser.svelte";
  import Button from "../UI/Button.svelte";
  import { navigate } from "svelte-routing";
  import CreateUser from "./CreateUser.svelte";
  let createBar = false;
  let editForm = false;
  let userlist = [];
  let grouplist = [];
  let currentUser;

  onMount(() => {
    getAllUser();
    getAllGroups();
  });

  async function getAllUser() {
    const url = "http://localhost:8080/fetchusers";
    fetch(url, {
      method: "POST",
      body: JSON.stringify({
        token: sessionStorage.getItem("JWT"),
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        userlist = data;
//         if (userlist.Message === "You are not allow to view this page") {
//           navigate("/dashboard");
//         }
      })
      .catch((error) => {
        console.log(error);
      });
  }

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

  function edituser(username) {
    const url = "http://localhost:8080/fetchuser";
    fetch(url, {
      method: "POST",
      body: JSON.stringify({
        username: username,
        editor: sessionStorage.getItem("JWT"),
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        currentUser = data;
        editForm = true;
      })
      .catch((error) => {
        console.log(error);
      });
  }

  function closeEditUser() {
    getAllUser();
    editForm = false;
  }
  const showCreate = () => {
    createBar = true;
  };
  const closeCreate = () => {
    getAllUser();
    createBar = false;
  };

</script>

<div class="page-container">
  {#if createBar}
    <CreateUser on:close={closeCreate} on:submit={()=>getAllUser()} users={userlist} />
  {:else}
    <div class="createDiv">
      <Button on:click={showCreate}>Create User</Button>
    </div>
  {/if}
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Email</th>
        <th>Status</th>
        <th>Groups</th>
        <th>Edit</th>
      </tr>
    </thead>
    {#each userlist as user, i}
      <tbody>
        <tr class={i % 2 === 0 && "alt-row"}>
          <td>{user.username}</td>
          <td>{user.email}</td>
          {#if user.status}
            <td class="allow">{user.status}</td>
          {:else}
            <td class="notAllow">{user.status}</td>
          {/if}
          <td>{user.belongsTo}</td>
          <td
            ><Button size="sm" mode="outline" on:click={edituser(user.username)}
              >Edit</Button
            ></td
          >
        </tr>
      </tbody>
    {/each}
  </table>

  {#if editForm}
    <EditUser on:close={closeEditUser} userlist={currentUser} {grouplist} />
  {/if}
</div>

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


  .allow {
    color: var(--success-color);
  }

  .notAllow {
    color: var(--danger-color);
  }

  .createDiv {
    width: 100vw;
    padding-top: 15px;
    padding-bottom: 15px;
    display: flex;
    justify-content: center;
  }

  .alt-row {
    background-color: var(--background-light-color);
  }
</style>
