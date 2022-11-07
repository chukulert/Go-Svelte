<script>
  import Modal from "../UI/Modal.svelte";
  import Button from "./Button.svelte";
  import { createEventDispatcher } from "svelte";
  import TextInput from "./TextInput.svelte";
  const dispatch = createEventDispatcher();


  export let task;
  export let oldTaskNote;
  export let show;
  // export let plan;
  export let filteredplans;
  export let group;

  let editedDescription;
  let addNoteDisable = true;
  let diff = false;
  let old = task.taskdes;
  let newNote = "";
  let tasknote = task.tasknote;
  let selectedplan = task.taskplan;
  const editDesc = (e) => {
        editedDescription = e.target.value;
        if (e.target.value != old) {
        diff = true;
        } else {
        diff = false;
        }
    }
  
    const handleEdit = () =>{
        const url = "http://localhost:8080/edittask";
        fetch(url, {
        method: "POST",
        body: JSON.stringify({
        editor: sessionStorage.getItem("JWT"),
        group: group,
        taskid:task.taskid,
        taskdes: editedDescription,
        field:"task_description",
        taskstate:task.taskstate,
        olddes:oldTaskNote,
        tasknote:task.tasknote,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        diff = false;
        dispatch("update")
        document.getElementById("tasknotes").value=task.tasknote
      })
      .catch((error) => {
        console.log(error);
      });
  };
  const newNoteChange = (e) => {
    newNote = e.target.value;
    if (newNote.length > 0) {
      addNoteDisable = false;
    } else {
      addNoteDisable = true;
    }
  };
  const addNoteSubmit = () => {
    //Junhe -- update added task notes only - no des
    const url = "http://localhost:8080/inserttasknote";
    fetch(url, {
      method: "POST",
        body: JSON.stringify({
        editor: sessionStorage.getItem("JWT"),
        group: group,
        taskid: task.taskid,
        taskstate:task.taskstate,
        taskdes: task.taskdes,
        olddes: task.taskdes,
        tasknote:task.tasknote,
        addedtasknote:newNote,
    }),
    }).then((response) => response.json())
      .then((data) => {
        diff = false;
        dispatch("update")
        document.getElementById("tasknotes").value=task.tasknote
        newNote = ""
        document.getElementById("addnotes").value = newNote
        addNoteDisable = true
      })
      .catch((error) => {
        console.log(error);
      });
  };
  const handleSelectPlan =(e)=>{
    const url = "http://localhost:8080/edittask";
        fetch(url, {
        method: "POST",
        body: JSON.stringify({
        editor: sessionStorage.getItem("JWT"),
        group: group,
        taskid:task.taskid,
        taskdes: e.target.value,
        field:"task_plan",
        taskstate:task.taskstate,
        olddes:oldTaskNote,
        tasknote:task.tasknote,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        selectedplan = e.target.value;
        dispatch("update")
      })
      .catch((error) => {
        console.log(error);
      });
  }
  const handlePromote = () => {
    dispatch("promote");
    //close form
    //get new data update dashboard
  };
  const handleDemote = () => {
    dispatch("demote");
    //closeform
    //demote api call udpate
  };
  const handleClose = () => {
    dispatch("close");
  };
</script>


<Modal on:close title={task.taskname}>
  <div class="taskDate">
    <p>Created on: {task.createdate}</p>
  </div>
  {#if task.taskstate == "open"}
    <div class="planSelection">
      <p>Plan:</p>
        {#if selectedplan == ""}
          <select on:change={handleSelectPlan}>
            <option value="" selected="selected">None</option>
            {#each filteredplans as p}
              <option value={p}>{p}</option>
            {/each}
          </select>
        {:else}
          <select on:change={handleSelectPlan} default={selectedplan}>
            <option value="">None</option>
            {#each filteredplans as p}
              {#if p == selectedplan}
                <option value={p} selected="selected">{p}</option>
              {:else}
                <option value={p}>{p}</option>
              {/if}
            {/each}
          </select>
        {/if}
    </div>
  {/if}
    <div class="mid">
      <div class="editSection">
        
        <textarea class="txt" value={task.taskdes}  on:input={editDesc} placeholder="Edit description" readonly={task.taskstate == "closed" || !show}></textarea>
        <div class="btn">
          <Button disabled={!(diff && task.taskstate != "closed")} mode="outline" on:click={handleEdit}>Edit</Button>
        </div>
      </div>


      
      <div class="addnotecontainer">
        <p>Task note:</p>
        <TextInput
      id="tasknotes"
        controlType="textarea"
        readonly={true}
        rows={10}
        resize={true}
        value={task.tasknote}
      />
        {#if task.taskstate != "closed"}
          <textarea placeholder="Enter new task notes" on:input={newNoteChange} class="nt" readonly={task.taskstate == "closed" || !show}></textarea>
          <div class="btn">
            <Button on:click={addNoteSubmit} mode="outline" disabled={addNoteDisable}
              >Add Notes</Button
            >
          </div>
        {/if}
      </div>
    </div>
  
 
  <div class="buttonDiv">
    <Button on:click={handleClose} mode="danger">Close</Button>
    {#if show}
    {#if task.taskstate != "closed"}
      <div class="btn-right">
        {#if task.taskstate == "doing" || task.taskstate == "done"}
          <Button on:click={handleDemote} mode="danger">Demote</Button>
        {/if}
        <Button on:click={handlePromote}>Promote</Button>
      </div>
    {/if}
    {/if}
  </div>
</Modal>

<style>
  .planSelection {
    position: absolute;
    display: flex;
    align-items: center;
    font-family: sans-serif;
    top: 20px;
    right: 40px;
    font-weight: 600;
    font-size: 14px;
  }
  .taskDate {
    font-family: sans-serif;
    font-size: 12px;
    margin-bottom: 5px;
    position: absolute;
    top: 35px;
  }
  .editSection {
    position: relative;
    width: 50%;
    height: 45vh;
    margin-bottom: 20px;
  }
  .txt{
    padding:5px;
    font-family: sans-serif;
    min-height: 100%;
    max-height: 100%;
    max-width: 100%;
    min-width: 100%;
    margin-right: 5px;
  }
  .nt{
    min-width: 100%;
    padding:5px;
    font-family: sans-serif;
    max-width: 100%;
    min-height: 50%;
    max-height: 50%;
  }
  .mid{
    display: flex;
  }
  .btn {
    z-index: 6;
    position: absolute;
    bottom: 1rem;
    right: 1.5rem;
    border-radius: 4px;
    box-shadow: 0px 2px 0px rgba(0, 0, 0, 0.45);
  }
  .addnotecontainer {
    width: 50%;
    height: 45vh;
    position: relative;
  }
  .buttonDiv {
    margin-top: 10px;
    display: flex;
    justify-content: space-between;
  }
  /* @media screen and (max-width: 1280px){
    .taskNote{
        min-height: 100px;
        max-height: 101px;
    }
    .addNote{
        min-height: 150px;
        max-height: 200px;
    }
    .taskDesc{
        min-height: 100px;
        max-height: 101px;
    }
} */
</style>
