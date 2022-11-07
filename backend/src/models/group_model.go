package models

import (
	"database/sql"
	"myModule/src/entities"
)

type GROUPDB struct {
	Db *sql.DB
}

// to get all groups
func (d GROUPDB) GetAllGroups() ([]entities.Groups, error) {
	result, err := d.Db.Query("SELECT * FROM usergroup")
	if err != nil {
		return nil, err
	}

	defer result.Close()

	groups := []entities.Groups{}
	for result.Next() {
		var grp entities.Groups

		// fmt.Println(result.Scan( &grp.Id, &grp.Groupname, &grp.Username))
		err := result.Scan(&grp.Groupname)

		if err != nil {
			return groups, nil
		}
		groups = append(groups, grp)

	}

	return groups, nil
}

// create new group
func (d GROUPDB) CreateNewGroup(gn string) (string, error) {

	groups, err := d.GetAllGroups()

	exists := false
	for i := 0; i < len(groups); i++ {
		if groups[i].Groupname == gn {
			exists = true
			break
		}
	}

	if exists {
		failure := "Group already exists"
		return failure, err
	} else {
		sql := `INSERT INTO usergroup (groupname) VALUES (?);`

		_, err := d.Db.Exec(sql, gn)

		if err != nil {
			failure := "SQL database error"
			return failure, err
		}

		success := "Successfully Created"
		return success, err
	}

}
