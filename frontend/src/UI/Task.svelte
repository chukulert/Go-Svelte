<script>
  import { onMount } from "svelte";
  import Button from "./Button.svelte";
  import TaskForm from "./TaskForm.svelte";
  import { createEventDispatcher } from "svelte";
  import appcolorMethods from "../store/color-store";
  import applicationMethods from "../store/application-store";

  // subscribing to writable data
  const colors = $appcolorMethods;

  const dispatch = createEventDispatcher();
  export let task;
  export let stateColor;
  export let state;
  export let filteredplans;
  let group = "";

  $: group =
    state === undefined
      ? ""
      : $applicationMethods.filter((e) => e.appname === task.taskacronym)[0][
          state
        ];

  let modal = false;
  let desc = "";
  let show = false;

  onMount(async () => {
    // await fetchplansbyapp()
    checkdes();
    checkGroup();
  });

  $: {task, checkGroup()}

  const checkdes = () => {
    if (task.taskdes.length > 18) {
      desc = task.taskdes.substring(0, 15) + "...";
    } else {
      desc = task.taskdes;
    }
  };

  const showModal = () => {
    modal = true;
  };
  const closeModal = () => {
    checkdes();
    modal = false;
  };

  const checkGroup = () => {
    modal = false;
    const url = "http://localhost:8080/authorize";
    fetch(url, {
      method: "POST",
      body: JSON.stringify({
        token: sessionStorage.getItem("JWT"),
        group: group,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.Message === "true") {
          show = true;
        } else {
          show = false;
        }
      })
      .catch((error) => {
        console.log(error);
      });
  };

  const promoteTask = () => {
    modal = false;
    const url = "http://localhost:8080/changestate";
    fetch(url, {
      method: "POST",
      body: JSON.stringify({
        editor: sessionStorage.getItem("JWT"),
        taskid: task.taskid,
        direction: 1,
        taskstate: task.taskstate,
        group: group,
        tasknote: task.tasknote,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        dispatch("update");
        if (data.Code == 408) {
          alert("You have no permission");
        }
      })
      .then(() => {
        if (task.taskstate == "doing") {
          const url = "http://localhost:8080/email";
          fetch(url, {
            method: "POST",
            body: JSON.stringify({
              editor: sessionStorage.getItem("JWT"),
              taskid: task.taskid,
              taskacronym:task.taskacronym,
              direction: 1,
              taskstate: task.taskstate,
              group: group,
              tasknote: task.tasknote,
            }),
          });
        }
      })
      .catch((error) => {
        alert("You have no permission");
      });
  };

  const demoteTask = () => {
    modal = false;
    const url = "http://localhost:8080/changestate";
    fetch(url, {
      method: "POST",
      body: JSON.stringify({
        editor: sessionStorage.getItem("JWT"),
        taskid: task.taskid,
        direction: 0,
        taskstate: task.taskstate,
        group: group,
        tasknote: task.tasknote,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        dispatch("update");
        if (data.Code == 408) {
          alert("You have no permission");
        }
      })
      .catch((error) => {
        alert("You have no permission");
      });
  };
  const update = () => {
    dispatch("update");
    checkdes();
  };

  // colors dictionary, current task selected, type either plan or app (0 or 1)
  function getColor(colors, task, type) {
    if (type == 0) {
      let planExist = Boolean(
        Object.keys(colors.planColors).find((key) =>
          key.includes(task.taskplan)
        )
      );
      if (planExist && task.taskplan !== "") {
        return colors.planColors[
          Object.keys(colors.planColors).find((key) =>
            key.includes(task.taskplan)
          )
        ];
      } else {
        return "white";
      }
    } else if (type == 1) {
      let appExist = Boolean(
        Object.keys(colors.appColors).find((key) =>
          key.includes(task.taskacronym)
        )
      );
      if (appExist && task.taskacronym !== "") {
        return colors.appColors[
          Object.keys(colors.appColors).find((key) =>
            key.includes(task.taskacronym)
          )
        ];
      } else {
        return "white";
      }
    }
  }
</script>

<main>
  {#if modal}
    <TaskForm
      on:close={closeModal}
      on:update={update}
      on:promote={promoteTask}
      on:demote={demoteTask}
      {task}
      oldTaskNote={task.taskdes}
      {filteredplans}
      {group}
      {show}
    />
  {/if}
  <div class="container">
    <div
      class="task-container"
      style="border-color: {stateColor}"
      on:click={showModal}
    >
      <!-- svelte-ignore a11y-mouse-events-have-key-events -->
      <div class="under">
        <span
          class="color"
          style="background-color: {getColor(colors, task, 1)};"
        />
        <div class="right">
          <p class="taskname">
            {task.taskname}
          </p>
          <p class="taskdesc">
            Desc: {desc}
          </p>
        </div>
      </div>
      <span
        class="planColor"
        style="background-color: {getColor(colors, task, 0)};"
      />
    </div>
    {#if show}
      <div>
        {#if task.taskstate == "doing" || task.taskstate == "done"}
          <div class="btn-sec-left">
            <Button on:click={demoteTask}>🡠</Button>
          </div>
          <div class="over">
            <Button on:click={promoteTask}>🡢</Button>
          </div>
        {:else if task.taskstate != "closed"}
          <div class="over">
            <Button on:click={promoteTask}>🡢</Button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</main>

<style>
  .container {
    position: relative;
    /* width: 95%; */
  }
  .task-container {
    padding: 4px 2px;
    border-radius: 4px;
    border: 2.5px solid var(--main-color);
    box-shadow: 0px 2px 0px rgba(0, 0, 0, 0.45);
    margin-bottom: 10px;
  }
  .under {
    background-color: #fff;
    transition: 250ms;
    z-index: 1;
    cursor: pointer;
    display: flex;
    min-height: 100px;
    max-height: 100px;
  }
  .color {
    width: 6px;
    border-radius: 25px;
  }
  .right {
    padding: 3px 5px;
  }
  .over {
    position: absolute;
    bottom: 15px;
    right: 10px;
    z-index: 3;
  }
  .planColor {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 20px;
    height: 20px;
    border-radius: 25px;
    border: 1px solid #bebebe;
    box-shadow: 1px 1px 0px rgba(0, 0, 0, 0.45);
  }
  .btn-sec-left {
    position: absolute;
    left: 15px;
    bottom: 15px;
  }
  .taskname {
    font-family: sans-serif;
    font-weight: 600;
  }
  .taskdesc {
    font-family: sans-serif;
    font-weight: 500;
    font-size: 12px;
    margin-left: 2px;
  }
</style>
