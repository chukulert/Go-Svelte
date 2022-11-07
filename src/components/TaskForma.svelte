<script>
  import Modal from "../UI/Modal.svelte";
  import Button from "../UI/Button.svelte";
  import TextInput from "../UI/TextInput.svelte";
  import { createEventDispatcher } from "svelte";
  import applicationMethods from "../store/application-store";

  const dispatch = createEventDispatcher();
  export let appselected;
  export let state;
  
  let group = state === undefined ? "":$applicationMethods.filter(e => e.appname === appselected)[0][state]; 


  let notes = "";
  let taskname = "";
  let taskdes = "";

  const emptyFields = () => {
    notes = ""
    taskname = "";
    taskdes = "";
  };

  const createTask = () => {
    if (taskname == "") {
      alert("Task name can't be empty");
      return;
    }

    // let valueone = `Add Note...`;
    // let taskselected = "";
    // let tasknames = ["QW","DS","FD"];

    // const createTask = (e) => {
    // e.preventDefault();
    // console.log(rnumber);
    const url = "http://localhost:8080/createtask";
    fetch(url, {
      method: "POST",
      body: JSON.stringify({
        taskname: taskname,
        taskdes: taskdes,
        addedtasknote: notes,
        taskacronym: appselected,
        editor: sessionStorage.getItem("JWT"),
        group: group,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.code != 200) {
          alert(data.Message);
        } else {
        alert("Task successfully added.");}
        dispatch("update")
        emptyFields();
      })
      .catch((error) => {
        console.log(error);
      });
  };
</script>

<Modal title="Create task" on:close>
  <form class="task-form" on:submit|preventDefault={createTask} >
    <TextInput
      id="name"
      type="text"
      label="Task Name: "
      placeholder="Enter task name"
      value={taskname}
      on:input={(e) => (taskname = e.target.value)}
    />

    <TextInput
      controlType="textarea"
      id="description"
      label="Task Description"
      rows="3"
      resize={true}
      placeholder="Enter task description"
      value={taskdes}
      on:input={(e) => (taskdes = e.target.value)}
    />

    <TextInput
      controlType="textarea"
      id="notes"
      label="Notes"
      placeholder="Enter task notes"
      resize={true}
      rows="3"
      value={notes}
      on:input={(e) => (notes = e.target.value)}
    />

    <div class="btn-container">
      <div></div>
      <Button type="submit" mode="outline">Submit</Button>
    </div>
  </form>
</Modal>

<style>
  .task-form {
    font-family: sans-serif;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .btn-container {
    width: 100%;
    display: flex;
    justify-content: space-between;
  }
</style>
