package models

import (
	"database/sql"
	"fmt"
	"log"
	"myModule/src/entities"
	"net/smtp"
	"os"
	"time"
)

type TASKDB struct {
	Db *sql.DB
}

func (d *TASKDB) SendEmail(taskid string) (bool, error) {
	//sender mail
	from := os.Getenv("EMAIL")
	password := os.Getenv("EPASS")
	//receiver list/indi
	to := []string{}
	// smtp config
	host := "smtp.gmail.com"
	port := "587"
	//creator list
	emailList := []string{}
	// mail content
	body := []byte(
		"Subject:" + taskid + "\r\n" +
			"\r\n" +
			"Task move to done")
	//rtn creator
	res, err := d.Db.Query("SELECT task_creator FROM task WHERE task_id = ?", taskid)
	if err != nil {
		fmt.Println(err, 4)
		return false, err
	}
	// mail person
	var personel string

	for res.Next() {
		err := res.Scan(&personel)
		if err != nil {
			fmt.Println(err, 1)
			return false, err
		}
		to = append(to, personel)
	}
	// mail list
	var email string
	for _, val := range to {
		em, err2 := d.Db.Query("SELECT email FROM accounts WHERE username = ?", val)
		if err2 != nil {
			fmt.Println(err2, 2)
			return false, err2
		}
		for em.Next() {
			err := em.Scan(&email)
			if err != nil {
				fmt.Println(err, 3)
				return false, err
			}
			emailList = append(emailList, email)
		}
	}
	//mail auth
	auth := smtp.PlainAuth("", from, password, host)
	// mail invocation
	err1 := smtp.SendMail(host+":"+port, auth, from, emailList, body)
	if err1 != nil {
		fmt.Println(err1, 5)
		return false, err
	}
	return true, nil
}

// JunHe - generate new note for task
func generateTaskNotes(state string, oldTasknote string, oldDes string, newDes string, addedNotes string, taskowner string) string {
	currentTime := time.Now()
	if oldTasknote != "" {
		if newDes == oldDes || oldDes == "" {
			if addedNotes == "" {
				newTaskNotes := "User: " + taskowner + " state:" + state + " timestamp:" + currentTime.Format("2006-01-02 15:04:05 Monday") + "\n" + oldTasknote
				return newTaskNotes
			} else {
				newTaskNotes := "User: " + taskowner + " state:" + state + " timestamp:" + currentTime.Format("2006-01-02 15:04:05 Monday") + "\nadded notes:" + addedNotes + "\n" + oldTasknote
				return newTaskNotes
			}
		} else { //des is change
			if addedNotes == "" {
				newTaskNotes := "User: " + taskowner + " state:" + state + " timestamp:" + currentTime.Format("2006-01-02 15:04:05 Monday") + "\nold des:" + oldDes + "\n" + oldTasknote
				return newTaskNotes
			} else {
				newTaskNotes := "User: " + taskowner + " state:" + state + " timestamp:" + currentTime.Format("2006-01-02 15:04:05 Monday") + "\nadded notes:" + addedNotes + "\nold des: " + oldDes + "\n" + oldTasknote
				return newTaskNotes
			}
		}
	} else {
		if addedNotes == "" {
			newTaskNotes := "User: " + taskowner + " state:" + state + " timestamp:" + currentTime.Format("2006-01-02 15:04:05 Monday")
			return newTaskNotes
		} else {
			newTaskNotes := "User: " + taskowner + " state:" + state + " timestamp:" + currentTime.Format("2006-01-02 15:04:05 Monday") + "\nadded notes:" + addedNotes
			return newTaskNotes
		}
	}
}

// Junhe - get taskid base on application Rnumber
func (d *TASKDB) generateTaskId(acronym string) (string, string) {
	result, err := d.Db.Query("SELECT app_rnumber FROM application Where app_acronym = ?;", acronym)
	if err != nil {
		return "false", ""
	}
	defer result.Close()
	var app_rnumber string
	for result.Next() {
		err := result.Scan(&app_rnumber)
		if err != nil {
			log.Fatal(err)
		}
	}
	return acronym + "_" + app_rnumber, app_rnumber
}

// JunHe - updateRnumber to application table
func (d *TASKDB) updateRnumber(acronym string, rnum string) bool {
	rnumber := 0
	_, err := fmt.Sscan(rnum, &rnumber)
	if err == nil {
		_, err := d.Db.Query("UPDATE application SET app_rnumber = ? WHERE (app_acronym = ?);", rnumber+1, acronym)
		return err != nil
	}
	return false
}

// JunHe - check if task name exist
func (d *TASKDB) checkTask(acronym string, taskname string) bool {
	result, err := d.Db.Query("SELECT count(*) FROM task WHERE task_name = ? AND task_app_acronym = ?;", taskname, acronym)
	if err != nil {
		return false
	}
	defer result.Close()
	var check int
	for result.Next() {
		if err := result.Scan(&check); err != nil {
			fmt.Println(err)
		}
	}
	return !(check >= 1)
}

// JunHe - check if app exist
func (d *TASKDB) checkApp(acronym string) bool {
	result, err := d.Db.Query("SELECT count(*) FROM application WHERE app_acronym =? ", acronym)
	if err != nil {
		return false
	}
	defer result.Close()
	var check int
	for result.Next() {
		if err := result.Scan(&check); err != nil {
			fmt.Println(err)
		}
	}
	return (check >= 1)
}

// JunHe - create task
func (d *TASKDB) CreateTask(taskName string, taskdes string, addedNote string, acronym string, taskcreator string) (bool, error) {
	taskId, rnum := d.generateTaskId(acronym)
	if (taskId != "false") && d.checkTask(acronym, taskName) && d.checkApp(acronym) {
		taskPlan := ""
		taskstate := "open"
		currentTime := time.Now()
		createdate := currentTime.Format("2006-01-02")
		genTasknotes := generateTaskNotes(taskstate, "", "", taskdes, addedNote, taskcreator)
		_, err := d.Db.Query("INSERT INTO task (task_name, task_description, task_notes,task_id,task_plan,task_app_acronym,task_state,task_creator,task_owner,task_createDate) VALUES (?,?,?,?,?,?,?,?,?,?);", taskName, taskdes, genTasknotes, taskId, taskPlan, acronym, taskstate, taskcreator, taskcreator, createdate)
		if err != nil {
			return false, err
		}
		d.updateRnumber(acronym, rnum)
		return true, nil
	} else {
		return false, nil
	}
}

// JunHe get all task model
func (d *TASKDB) GetAllTask() ([]entities.Task, error) {
	result, err := d.Db.Query("SELECT * FROM task")
	if err != nil {
		return nil, err
	}
	defer result.Close()

	tasks := []entities.Task{}
	for result.Next() {
		var task entities.Task
		if err := result.Scan(&task.TaskName, &task.Des, &task.Note, &task.Id, &task.Plan, &task.Acronym, &task.State, &task.Creator, &task.Owner, &task.CreateDate); err != nil {
			// tasks = append(tasks, task)
		}
		tasks = append(tasks, task)
	}
	return tasks, nil
}

// JunHe getTaskByApp
func (d *TASKDB) GetTaskByApp(acronym string) ([]entities.Task, error) {
	result, err := d.Db.Query("SELECT * FROM task WHERE task_app_acronym = ?", acronym)
	if err != nil {
		return nil, err
	}
	defer result.Close()

	tasks := []entities.Task{}
	for result.Next() {
		var task entities.Task
		if err := result.Scan(&task.TaskName, &task.Des, &task.Note, &task.Id, &task.Plan, &task.Acronym, &task.State, &task.Creator, &task.Owner, &task.CreateDate); err != nil {
			// tasks = append(tasks, task)
		}
		tasks = append(tasks, task)
	}
	return tasks, nil
}

// JunHe getTaskByAppandPlan
func (d *TASKDB) GetTaskByAppNPlan(acronym string, plan string) ([]entities.Task, error) {
	result, err := d.Db.Query("SELECT * FROM task WHERE task_app_acronym = ? AND task_plan = ?", acronym, plan)
	if err != nil {
		return nil, err
	}
	defer result.Close()

	tasks := []entities.Task{}
	for result.Next() {
		var task entities.Task
		if err := result.Scan(&task.TaskName, &task.Des, &task.Note, &task.Id, &task.Plan, &task.Acronym, &task.State, &task.Creator, &task.Owner, &task.CreateDate); err != nil {
			// tasks = append(tasks, task)
		}
		tasks = append(tasks, task)
	}
	return tasks, nil
}

// Glenn
// to transition a state
// # current is the existing task state
// # direction 0 -> left , 1 -> right
// # returns a message

func (d TASKDB) TransitionState(taskID string, current string, direction int, oldtasknote string, owner string) (string, error) {
	var newState string
	var states = [5]string{"open", "todo", "doing", "done", "closed"}
	for i := 0; i < len(states); i++ {

		if states[i] == current && direction == 1 {
			newState = states[i+1]
			break
		} else if states[i] == current && direction == 0 {
			newState = states[i-1]
		}
	}
	tasknote := generateTaskNotes(newState, oldtasknote, "", "", "", owner)
	sql := `UPDATE task SET task_state = ?, task_notes = ?, task_owner = ? WHERE task_id = ?`
	_, err := d.Db.Exec(sql, newState, tasknote, owner, taskID)
	if err != nil {
		failure := "SQL database error"
		return failure, err
	}

	success := "Successfully updated state"
	return success, err
}

// GIN EDIT TASK
func (d *TASKDB) EditTask(taskid string, taskdesc string, taskfield string, taskowner string, taskstate string, old string, tasknote string) (bool, error) {
	if taskfield != "task_plan" {
		note := generateTaskNotes(taskstate, tasknote, old, taskdesc, "", taskowner)
		sql := "UPDATE task SET " + taskfield + " = ? WHERE task_id = ?"
		_, err := d.Db.Query(sql, taskdesc, taskid)
		if err != nil {
			return false, err
		} else {
			_, err2 := d.Db.Query("UPDATE task SET task_notes = ? WHERE task_id = ?;", note, taskid)
			if err2 != nil {
				return false, err
			}
		}
		return true, nil
	} else {
		//change plan for now will not generateTasknotes
		sql := "UPDATE task SET " + taskfield + " = ? WHERE task_id = ?"
		_, err := d.Db.Query(sql, taskdesc, taskid)
		if err != nil {
			return false, err
		} else {
			return true, nil
		}
	}

}

func (d TASKDB) InsertTaskNote(taskid string, state string, oldTasknote string, oldDes string, newDes string, addedNotes string, taskowner string) (bool, error) {
	tasknotes := generateTaskNotes(state, oldTasknote, oldDes, newDes, addedNotes, taskowner)
	sql := `UPDATE task SET task_notes = ? WHERE task_id = ?`
	_, err := d.Db.Exec(sql, tasknotes, taskid)
	if err != nil {
		return false, err
	}
	return true, err

}
