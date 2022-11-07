<script>
  import { createEventDispatcher, onMount } from "svelte";
  import MultiSelect from "svelte-multiselect";
  import Modal from "../UI/Modal.svelte";
  import TextInput from "../UI/TextInput.svelte";
  import Button from "../UI/Button.svelte";
  const dispatch = createEventDispatcher();
  export let userlist;
  export let grouplist;
  let newPassword = "";
  let username = userlist.username;
  let password = userlist.password;
  let email = userlist.email;
  let status = userlist.status;
  let belongsTo = userlist.belongsTo;
  let selected = [];

  const pwRegex = new RegExp(
    /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,10}$/
  );
  const emailRegex = new RegExp(
    /^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)$/
  );
  onMount(() => {
    if (belongsTo.length) {
      selected = belongsTo.split(",");
    }
  });

  async function updateUser() {
    console.log(newPassword);
    if (emailRegex.test(email) || email === ""){
      if (newPassword === "") {
      const url = "http://localhost:8080/updatealluserinfoep";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          username: username,
          email: email,
          status: status,
          belongsTo: selected.join(","),
          editor: sessionStorage.getItem("JWT"),
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          alert(data.Message);
          console.log(data);
        })
        .catch((error) => {
          console.log(error);
        });
    } else {
      if (!pwRegex.test(newPassword)) {
        alert("Password does not meet requirement");
      } else {
        const url = "http://localhost:8080/updatealluserinfo";
        fetch(url, {
          method: "POST",
          body: JSON.stringify({
            username: username,
            password: newPassword,
            email: email,
            status: status,
            belongsTo: selected.join(","),
            editor: sessionStorage.getItem("JWT"),
          }),
        })
          .then((response) => response.json())
          .then((data) => {
            alert(data.Message);
            console.log(data);
          })
          .catch((error) => {
            console.log(error);
          });
      }
    }
    }else{
      alert("Email does not meet requirement")
    }
    
  }

  function revert() {
    alert("Information reset to when it first open");
    newPassword = "";
    belongsTo = userlist.belongsTo;
    if (belongsTo.length) {
      selected = belongsTo.split(",");
    }
    email = userlist.email;
    password = userlist.password;
    status = userlist.status;
    const url = "http://localhost:8080/revertuserpassword";
    fetch(url, {
      method: "POST",
      body: JSON.stringify({
        username: username,
        password: password,
        editor: sessionStorage.getItem("JWT"),
      }),
    })
      .then((response) => response.json())
      .then((_) => {
      })
      .catch((error) => {
        console.log(error);
      });
  }
</script>

<Modal title="Edit User" on:close>
  <form on:submit|preventDefault={updateUser}>
    <div class="name-status">
      <div><strong>Username: </strong>{username}</div>
      <div>
        <label for="checkbox"><strong>Access Status</strong></label>
        <input
          type="checkbox"
          bind:checked={status}
          name="checkbox"
          id="checkbox"
        />
      </div>
    </div>

    <TextInput
      id="password"
      label="New password"
      type="password"
      placeholder="Enter a password"
      on:input={(e) => (newPassword = e.target.value)}
    />

    <TextInput
      id="password"
      label="Email"
      type="email"
      placeholder="Enter email"
      value={email}
      on:input={(e) => (email = e.target.value)}
    />
    <label for="groups"><strong>Groups</strong></label>
    <MultiSelect bind:selected options={grouplist} id="groups" />
    <div class="footer-btn">
      <Button type="submit">Update</Button>
      <Button on:click={revert} type="submit" mode="danger">Revert</Button>
    </div>
  </form>
</Modal>

<style>
  form {
    font-family: sans-serif;
  }

  .name-status {
    display: flex;
    justify-content: space-between;
  }

  .footer-btn {
    display: flex;
    padding: 0.5rem;
    justify-content: space-between;
  }
</style>
