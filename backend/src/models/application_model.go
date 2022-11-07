package models

import (
	"database/sql"
    "myModule/src/entities"
	"fmt"
)

type APPDB struct {
	Db *sql.DB
}

//DANIEL
func (d *APPDB) CreateApp(AppAcronym string, Description string, Rnumber string,  StartDate string, EndDate string, PermitCreate string, PermitOpen string, PermitToDo string, PermitDoing string, PermitDone string) (bool, error) {
	_, err := d.Db.Query("INSERT INTO application(app_acronym,app_description,app_rnumber,app_startDate,app_endDate,app_permit_create,app_permit_open,app_permit_toDoList,app_permit_doing,app_permit_done) values(?,?,?,?,?,?,?,?,?,?);", AppAcronym, Description, Rnumber, StartDate, EndDate, PermitCreate, PermitOpen, PermitToDo, PermitDoing, PermitDone)
	if err != nil {
		// fmt.Println(err)
		return false, err
	}
	return true, nil
}

func (d *APPDB) EditApp(AppAcronym string, PermitCreate string, PermitOpen string, PermitToDo string, PermitDoing string, PermitDone string) (bool, error) {
	_, err := d.Db.Query("UPDATE application SET app_permit_create = ?, app_permit_open = ?, app_permit_toDoList = ?, app_permit_doing = ?, app_permit_done = ? WHERE app_acronym = ?", PermitCreate, PermitOpen, PermitToDo, PermitDoing, PermitDone, AppAcronym)
	if err != nil {
		fmt.Println(err)
		return false, err
	}
	return true, nil
}

func (d APPDB) GetAllApps() ([]entities.Applications, error) {
	result, err := d.Db.Query("SELECT * FROM application")
	if err != nil {
		return nil, err
	}
	defer result.Close()

	apps := []entities.Applications{}
	for result.Next() {
		var app entities.Applications
		err := result.Scan(&app.AppAcronym, &app.Description, &app.Rnumber, &app.StartDate, &app.EndDate, &app.PermitCreate, &app.PermitOpen, &app.PermitToDo, &app.PermitDoing, &app.PermitDone) 
		if err != nil {
			return apps, nil
		}
		apps = append(apps, app)
	}
	return apps, nil
}

